fn main() {
    tonic_build::compile_protos("proto/md5rs.proto")
        .unwrap_or_else(|e| panic!("Failed to compile protos {:?}", e));
    tauri_build::build()
}
