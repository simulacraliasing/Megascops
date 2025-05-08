import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
    dialogConfig,
    detectStatus,
    config,
    type Config,
} from "./store.svelte";
import { open, confirm, ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { Command, open as openFile } from "@tauri-apps/plugin-shell";
import { exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import { unwrapFunctionStore, format } from "svelte-i18n";

const $format = unwrapFunctionStore(format);

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const openSelectedFolder = () => {
    openFile(config.detectOptions.selectedFolder);
    closeDialog();
};

export const showDialog = (title: string, description: string) => {
    dialogConfig.isOpen = true;
    dialogConfig.title = title;
    dialogConfig.description = description;
};

export const closeDialog = () => {
    dialogConfig.isOpen = false;
    dialogConfig.title = "";
    dialogConfig.description = "";
};

interface SelectOptions {
    directory?: boolean;
    filters?: { name: string; extensions: string[] }[];
    title: string;
}

export async function selectPath({
    directory = false,
    filters,
    title,
}: SelectOptions) {
    try {
        const selected = await open({
            directory,
            multiple: false,
            filters,
            title,
        });

        if (selected) {
            return Array.isArray(selected) ? selected[0] : selected;
        }

        return undefined;
    } catch (err) {
        console.error(
            `Failed to select ${directory ? "folder" : "file"}:`,
            err
        );
        return undefined;
    }
}

export const selectFolder = async () =>
    (config.detectOptions.selectedFolder = await selectPath({
        directory: true,
        title: "Select Media Folder",
    }));

export const selectResumePath = async () =>
    (config.detectOptions.resumePath = await selectPath({
        filters: [{ name: "Result file", extensions: ["json", "csv"] }],
        title: "Select result file",
    }));

export const selectBufferFolder = async () =>
    (config.configOptions.bufferPath = await selectPath({
        directory: true,
        title: "Select Buffer Folder",
    }));

export function formatQuota(quota?: number): string {
    if (!quota) {
        return "invalid";
    }

    if (quota < 1) {
        return "unlimited";
    }

    if (quota >= 1000000000) {
        return (quota / 1000000000).toFixed(1).replace(/\.0$/, "") + "b";
    }

    if (quota >= 1000000) {
        return (quota / 1000000).toFixed(1).replace(/\.0$/, "") + "m";
    }

    if (quota >= 1000) {
        return (quota / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    }

    return quota.toString();
}

export async function checkHealth() {
    try {
        console.log(`{ grpcUrl: ${config.detectOptions.grpcUrl} }`);
        await invoke("check_health", { grpcUrl: config.detectOptions.grpcUrl });
    } catch (err) {
        console.error("Health check failed:", err);
    }
}

export async function checkQuota() {
    try {
        await invoke("check_quota", {
            grpcUrl: config.detectOptions.grpcUrl,
            token: config.detectOptions.accessToken,
        });
        console.log("Quota checked");
    } catch (err) {
        console.error("Auth failed:", err);
    }
}

export async function saveConfig() {
    try {
        const store = await load("store.json", { autoSave: false });

        await store.set("config", config);

        console.log("Configuration stored successfully");
    } catch (err) {
        console.error("Failed to store configuration:", err);
    }
}

export async function loadConfig() {
    try {
        const store = await load("store.json", { autoSave: false });
        const config_stored = (await store.get("config")) as Config;
        if (config_stored) {
            config.configOptions = config_stored.configOptions;
            config.detectOptions = config_stored.detectOptions;
            config.firstRun = config_stored.firstRun;
        }
    } catch (err) {
        console.error("Failed to load configuration:", err);
    }
}

export async function startProcessing() {
    if (!config.detectOptions.selectedFolder) {
        alert("Please select a folder first");
        return;
    }

    const resultFileName = `result.${config.configOptions.exportFormat === "Json" ? "json" : "csv"}`;
    const resultFilePath = `${config.detectOptions.selectedFolder}/${resultFileName}`;

    let proceed = true;
    let useResume = false;

    try {
        // const fileExists = await exists(resultFilePath);
        const fileExists = await invoke<boolean>("check_path_exists", { pathStr: resultFilePath });

        if (fileExists) {
            proceed = false; 
            const shouldOverwrite = await confirm(
                $format("dialog.message.resultFileExists", { values: { resultFileName } }),
                { title: $format("dialog.title.resultFileExists"), kind: "warning", okLabel: $format("dialog.button.overwrite"), cancelLabel: $format("dialog.button.no") }
            );

            if (shouldOverwrite) {
                config.detectOptions.resumePath = null;
                proceed = true;
                console.log("User chose to overwrite existing result file.");
            } else {
                const shouldResume = await ask(
                    $format("dialog.message.resumeFromCheckpoint", { values: { resultFileName } }),
                    { title: $format("dialog.title.resume"), kind: "info", okLabel: $format("dialog.button.resume"), cancelLabel: $format("dialog.button.cancel") }
                );

                if (shouldResume) {
                    config.detectOptions.resumePath = resultFilePath; 
                    proceed = true;
                    useResume = true; 
                    console.log("(User) Resume using existing result file.");
                } else {
                    showDialog($format("dialog.title.cancel"), $format("dialog.message.userCancel"));
                    console.log("(User) Cancelled processing.");
                    return;
                }
            }
        } else {
            if (!config.detectOptions.resumePath?.trim()) {
                config.detectOptions.resumePath = null;
            }
            proceed = true;
        }

    } catch (err) {
        console.error("Error checking for existing result file:", err);
        showDialog($format("dialog.title.Error"), `Error checking for existing result file: ${err}.`);
        proceed = true;
        if (!useResume) {
            config.detectOptions.resumePath = null;
        }
    }
    
    if (proceed) {
        config.detectOptions.resumePath =
            config.detectOptions.resumePath?.trim() || null;

        config.configOptions.bufferPath =
            config.configOptions.bufferPath?.trim() || null;

        await saveConfig();

        detectStatus.isProcessing = true;
        detectStatus.progress = 0;

        try {
            console.log("Starting processing with config:", config);

            await invoke("process_media", {
                config,
            });

            console.log("Processing complete");
        } catch (err) {
            console.error("Processing failed:", err);
            detectStatus.isProcessing = false;
        }
    }
}

export async function organize() {
    let command;
    const resultFile = `${config.detectOptions.selectedFolder}/result${
        config.configOptions.exportFormat === "Json" ? ".json" : ".csv"
    }`;
    const logFile = `${config.detectOptions.selectedFolder}/organize.log`;
    if (config.detectOptions.guess) {
        command = Command.sidecar(
            "binaries/organize",
            [
                "--result",
                resultFile,
                "--mode",
                "guess",
                "--log-level",
                "INFO",
                "--log-file",
                logFile,
            ],
            { encoding: "utf8" }
        );
    } else {
        command = Command.sidecar(
            "binaries/organize",
            [
                "--result",
                resultFile,
                "--mode",
                "default",
                "--log-level",
                "INFO",
                "--log-file",
                logFile,
            ],
            { encoding: "utf8" }
        );
    }
    detectStatus.isOrganizing = true;
    const output = await command.execute();
    if (output.code !== 0) {
        detectStatus.isOrganizing = false;
        showDialog(
            $format("dialog.title.Error"),
            `${$format("dialog.message.organizeFailed")}${logFile}`
        );
    } else {
        detectStatus.isOrganizing = false;
        showDialog(
            $format("dialog.title.Organize"),
            `${$format("dialog.message.organizeComplete")}${logFile}`
        );
    }
}

export async function undo() {
    const resultFile = `${config.detectOptions.selectedFolder}/result${
        config.configOptions.exportFormat === "Json" ? ".json" : ".csv"
    }`;
    const logFile = `${config.detectOptions.selectedFolder}/organize.log`;
    const command = Command.sidecar(
        "binaries/organize",
        [
            "--result",
            resultFile,
            "--mode",
            "undo",
            "--log-level",
            "INFO",
            "--log-file",
            logFile,
        ],
        { encoding: "utf8" }
    );
    detectStatus.isUndoOrganizing = true;
    const output = await command.execute();
    if (output.code !== 0) {
        detectStatus.isUndoOrganizing = false;
        showDialog(
            $format("dialog.title.Error"),
            `${$format("dialog.message.undoFailed")}${logFile}`
        );
    } else {
        detectStatus.isUndoOrganizing = false;
        showDialog(
            $format("dialog.title.Undo"),
            `${$format("dialog.message.undoComplete")}${logFile}`
        );
    }
}

export async function toggleConfig() {
    detectStatus.showConfig = !detectStatus.showConfig;
    detectStatus.configIconAnimating = true;
    setTimeout(() => {
        detectStatus.configIconAnimating = false;
    }, 500);
}

function debounce<F extends (...args: unknown[]) => unknown>(
    func: F,
    timeout = 500
): (...args: Parameters<F>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;

    return (...args: Parameters<F>): void => {
        if (timer) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            func(...args);
        }, timeout);
    };
}
export const debouncedCheckHealth = debounce(checkHealth, 800);

export const debouncedCheckQuota = debounce(checkQuota, 800);
