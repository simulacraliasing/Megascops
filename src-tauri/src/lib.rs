use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use crossbeam_channel::{bounded, unbounded};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tonic::{
    transport::{Certificate, Channel, ClientTlsConfig},
    Request,
};
use tracing::{error, info};
use tracing_appender::non_blocking;
use url::Url;
use uuid::Uuid;

use md5rs::md5rs_client::Md5rsClient;
use md5rs::{AuthRequest, AuthResponse, DetectRequest, HealthRequest, HealthResponse};

pub mod md5rs {
    tonic::include_proto!("md5rs");
}

pub mod export;
pub mod io;
pub mod log;
pub mod media;
pub mod utils;

pub use export::{export_worker, parse_export_csv, Bbox, ExportFrame};
pub use media::{media_worker, WebpItem};
pub use utils::FileItem;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Config {
    pub folder: String,
    pub url: String,
    pub token: String,
    pub max_frames: Option<usize>,
    pub iframe_only: bool,
    pub iou: f32,
    pub conf: f32,
    pub quality: f32,
    pub export: ExportFormat,
    pub checkpoint: usize,
    pub resume_from: Option<String>,
    pub buffer_path: Option<String>,
    pub buffer_size: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum ExportFormat {
    Json,
    Csv,
}

pub async fn process(
    config: Config,
    progress_sender: crossbeam_channel::Sender<usize>,
) -> Result<()> {
    let url = Url::parse(&config.url)?;
    let host = url.host_str().unwrap();

    let pem = utils::get_tls_certificate(&config.url)?;
    let ca = Certificate::from_pem(pem);
    let tls = ClientTlsConfig::new().ca_certificate(ca).domain_name(host);

    let channel = Channel::from_shared(url.to_string())
        .context("Invalid URL")?
        .tls_config(tls)
        .context("Failed to configure TLS")?
        .connect()
        .await
        .context("Failed to connect to server")?;

    let mut client = Md5rsClient::new(channel);
    let auth_response = auth(&mut client, &config.token).await?;

    let session_token = auth_response.token;

    cleanup_buffer(&config.buffer_path)?;

    if config.checkpoint == 0 {
        error!("Checkpoint should be greater than 0");
        return Ok(());
    }

    let folder_path = std::path::PathBuf::from(&config.folder);
    let folder_path = std::fs::canonicalize(folder_path)?;

    let imgsz = 1280;
    let start = Instant::now();

    let mut file_paths = utils::index_files_and_folders(&folder_path);

    let export_data = Arc::new(Mutex::new(Vec::new()));
    let frames = Arc::new(Mutex::new(HashMap::<String, ExportFrame>::new()));

    let file_paths = match config.resume_from {
        Some(checkpoint_path) => {
            let all_files =
                resume_from_checkpoint(&checkpoint_path, &mut file_paths, &export_data)?;
            all_files.to_owned()
        }
        None => file_paths,
    };

    let (media_q_s, media_q_r) = bounded(8);
    let (io_q_s, io_q_r) = bounded(config.buffer_size);
    let (export_q_s, export_q_r) = unbounded();
    let checkpoint_counter = Arc::new(Mutex::new(0 as usize));
    let progress_sender_clone = progress_sender.clone();

    let buffer_path = config.buffer_path.clone();
    let folder_path_clone = folder_path.clone();
    let export_data_clone = Arc::clone(&export_data);
    let finish = Arc::new(Mutex::new(false));
    let finish_clone = Arc::clone(&finish);

    thread::spawn(move || {
        let export_data = Arc::clone(&export_data);
        let folder_path = folder_path.clone();
        let checkpoint_counter = Arc::clone(&checkpoint_counter);
        export_worker(
            config.checkpoint,
            &checkpoint_counter,
            &config.export,
            &folder_path,
            export_q_r,
            &export_data,
        );
        let mut finish_lock = finish.lock().unwrap();
        *finish_lock = true;
    });

    if let Some(buffer_path) = buffer_path {
        rayon::spawn(move || {
            std::fs::create_dir_all(&buffer_path).unwrap();
            let buffer_path = std::fs::canonicalize(buffer_path).unwrap();

            let io_handle = thread::spawn(move || {
                for file in file_paths.iter() {
                    io::io_worker(&buffer_path, file, io_q_s.clone()).unwrap();
                }
                drop(io_q_s);
            });

            io_q_r.iter().par_bridge().for_each(|file| {
                media_worker(
                    file,
                    imgsz,
                    config.quality,
                    config.iframe_only,
                    config.max_frames,
                    media_q_s.clone(),
                    progress_sender_clone.clone(),
                );
            });
            io_handle.join().unwrap();
        });
    } else {
        rayon::spawn(move || {
            file_paths.par_iter().for_each(|file| {
                media_worker(
                    file.clone(),
                    imgsz,
                    config.quality,
                    config.iframe_only,
                    config.max_frames,
                    media_q_s.clone(),
                    progress_sender_clone.clone(),
                );
            });
            drop(media_q_s);
        });
    }

    let frames_clone = Arc::clone(&frames);
    let export_q_s_clone = export_q_s.clone();
    let outbound = async_stream::stream! {
        while let Ok(item) = media_q_r.recv() {
            match item {
                WebpItem::Frame(frame) => {
                    let uuid = Uuid::new_v4().to_string();
                    let export_frame = ExportFrame {
                        file: frame.file.clone(),
                        frame_index: frame.frame_index,
                        shoot_time: frame.shoot_time.map(|t| t.to_string()),
                        total_frames: frame.total_frames,
                        bboxes: None,
                        label: None,
                        error: None,
                    };
                    frames_clone.lock().unwrap().insert(uuid.clone(), export_frame);
                    yield DetectRequest { uuid, image: frame.webp, width: frame.width as i32, height: frame.height as i32, iou: config.iou, score: config.conf };
                }
                WebpItem::ErrFile(file) => {
                    export_q_s_clone.send(ExportFrame {
                        file: file.file.clone(),
                        frame_index: 0,
                        shoot_time: None,
                        total_frames: 0,
                        bboxes: None,
                        label: None,
                        error: Some(file.error.to_string()),
                    }).unwrap();
                }
            }
        }
    };

    let mut request = Request::new(outbound);
    request
        .metadata_mut()
        .insert("authorization", session_token.parse().unwrap());

    let response = client.detect(request).await;
    let mut inbound = match response {
        Ok(response) => response.into_inner(),
        Err(status) => {
            error!("{}", status.message());
            cleanup_buffer(&config.buffer_path)?;
            return Ok(());
        }
    };

    loop {
        match inbound.message().await {
            Ok(Some(response)) => {
                let uuid = response.uuid.clone();
                let mut frames = frames.lock().unwrap();
                if let Some(mut frame) = frames.remove(&uuid) {
                    frame.bboxes = Some(
                        response
                            .bboxs
                            .into_iter()
                            .map(|bbox| Bbox {
                                x1: bbox.x1,
                                y1: bbox.y1,
                                x2: bbox.x2,
                                y2: bbox.y2,
                                class: bbox.class as usize,
                                score: bbox.score,
                            })
                            .collect(),
                    );
                    frame.label = Some(response.label);
                    export_q_s.send(frame).unwrap();
                }
            }
            Ok(None) => {
                drop(export_q_s);
                while !*finish_clone.lock().unwrap() {
                    thread::sleep(Duration::from_millis(100));
                }
                export::export(&folder_path_clone, export_data_clone, &config.export)?;
                cleanup_buffer(&config.buffer_path)?;
                break;
            }
            Err(e) => {
                error!("Error receiving detection: {}", e);
                drop(export_q_s);
                while !*finish_clone.lock().unwrap() {
                    thread::sleep(Duration::from_millis(100));
                }
                export::export(&folder_path_clone, export_data_clone, &config.export)?;
                cleanup_buffer(&config.buffer_path)?;
                break;
            }
        }
    }

    info!("Elapsed time: {:?}", start.elapsed());
    Ok(())
}

async fn auth(client: &mut Md5rsClient<Channel>, token: &str) -> Result<AuthResponse> {
    let response = client
        .auth(Request::new(AuthRequest {
            token: token.to_string(),
        }))
        .await?;
    let auth_response = response.into_inner();
    if auth_response.success {
        Ok(auth_response)
    } else {
        Err(anyhow::anyhow!("Auth failed"))
    }
}

async fn get_auth(grpc_url: String, token: String) -> Result<i32> {
    let url = Url::parse(&grpc_url)?;
    let host = url.host_str().unwrap();

    let pem = utils::get_tls_certificate(&grpc_url)?;
    let ca = Certificate::from_pem(pem);
    let tls = ClientTlsConfig::new().ca_certificate(ca).domain_name(host);

    let channel = Channel::from_shared(url.to_string())?
        .tls_config(tls)?
        .connect()
        .await?;

    let mut client = Md5rsClient::new(channel);

    match auth(&mut client, &token).await {
        Ok(response) => Ok(response.quota),
        Err(_) => Err(anyhow::anyhow!("Auth failed")),
    }
}

async fn health(client: &mut Md5rsClient<Channel>) -> Result<()> {
    let response = client.health(Request::new(HealthRequest {})).await?;
    let health_response = response.into_inner();
    if health_response.status {
        Ok(())
    } else {
        Err(anyhow::anyhow!("Check failed"))
    }
}

async fn get_health(grpc_url: String) -> Result<bool> {
    let url = Url::parse(&grpc_url)?;
    let host = url.host_str().unwrap();

    let pem = utils::get_tls_certificate(&grpc_url)?;
    let ca = Certificate::from_pem(pem);
    let tls = ClientTlsConfig::new().ca_certificate(ca).domain_name(host);

    let channel = Channel::from_shared(url.to_string())?
        .tls_config(tls)?
        .connect()
        .await?;

    let mut client = Md5rsClient::new(channel);

    match health(&mut client).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

fn cleanup_buffer(buffer_path: &Option<String>) -> Result<()> {
    if let Some(path) = buffer_path {
        let path = std::path::PathBuf::from(path);
        if path.exists() {
            std::fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

fn resume_from_checkpoint<'a>(
    checkpoint_path: &str,
    all_files: &'a mut HashSet<FileItem>,
    export_data: &Arc<Mutex<Vec<ExportFrame>>>,
) -> Result<&'a mut HashSet<FileItem>> {
    let checkpoint = Path::new(checkpoint_path);
    if !checkpoint.exists() {
        error!("Checkpoint file does not exist");
        return Err(anyhow::anyhow!("Checkpoint file does not exist"));
    }
    if !checkpoint.is_file() {
        error!("Checkpoint path is not a file");
        return Err(anyhow::anyhow!("Checkpoint path is not a file"));
    }
    match checkpoint.extension() {
        Some(ext) => {
            let ext = ext.to_str().unwrap();
            if ext != "json" && ext != "csv" {
                error!("Invalid checkpoint file extension: {}", ext);
                return Err(anyhow::anyhow!(
                    "Invalid checkpoint file extension: {}",
                    ext
                ));
            } else {
                let frames;
                if ext == "json" {
                    let json = std::fs::read_to_string(checkpoint)?;
                    frames = serde_json::from_str(&json)?;
                } else {
                    frames = parse_export_csv(checkpoint)?;
                }
                let mut file_frame_count = HashMap::new();
                let mut file_total_frames = HashMap::new();
                for f in &frames {
                    let file = &f.file;
                    let count = file_frame_count.entry(file.clone()).or_insert(0);
                    *count += 1;
                    file_total_frames
                        .entry(file.clone())
                        .or_insert(f.total_frames);

                    if let Some(total_frames) = file_total_frames.get(&file) {
                        if let Some(frame_count) = file_frame_count.get(&file) {
                            if total_frames == frame_count {
                                all_files.remove(&file);
                            }
                        }
                    }
                }
                export_data.lock().unwrap().extend_from_slice(&frames);
                Ok(all_files)
            }
        }
        None => {
            error!("Invalid checkpoint file extension");
            return Err(anyhow::anyhow!("Invalid checkpoint file extension"));
        }
    }
}

#[tauri::command]
async fn check_health(app: AppHandle, grpc_url: String) {
    if let Ok(health) = get_health(grpc_url).await {
        app.emit("health-status", health).unwrap();
    } else {
        app.emit("health-status", false).unwrap();
    }
}

#[tauri::command]
async fn check_quota(app: AppHandle, grpc_url: String, token: String) {
    if let Ok(quota) = get_auth(grpc_url, token).await {
        app.emit("quota", quota).unwrap();
    } else {
        app.emit("quota", -1).unwrap();
    }
}

#[tauri::command]
async fn process_media(app: AppHandle, config: Config) {
    let (progress_sender, progress_receiver) = crossbeam_channel::unbounded();

    // let guard = log::init_logger("info".to_string(), "./megascops.log".to_string())
    //     .expect("Failed to initialize logger");

    let total_files = crate::utils::index_files_and_folders(&PathBuf::from(&config.folder)).len();

    let app_clone = app.clone();

    let progress_thread = std::thread::spawn(move || {
        let mut progress = 0.0;
        for _ in progress_receiver.iter() {
            progress += 1.0 / total_files as f32 * 100.0;
            app_clone
                .emit("detect-progress", progress as usize)
                .unwrap();
        }
    });

    match process(config, progress_sender).await {
        Ok(_) => {
            app.emit("detect-complete", 1).unwrap();
        }
        Err(e) => {
            app.emit("detect-error", e.to_string()).unwrap();
            error!("Error processing: {}", e);
        }
    }
    progress_thread.join().unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    static mut LOGGER_GUARD: Option<non_blocking::WorkerGuard> = None;

    unsafe {
        LOGGER_GUARD = Some(
            log::init_logger("info".to_string(), "./megascops.log".to_string())
                .expect("Failed to initialize logger"),
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![process_media, check_health, check_quota])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
