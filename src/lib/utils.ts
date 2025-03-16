import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { dialogConfig, detectStatus, config } from "./store.svelte";
import { open } from "@tauri-apps/plugin-dialog";
import { init, register, getLocaleFromNavigator } from "svelte-i18n";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { Command, open as openFile } from "@tauri-apps/plugin-shell";
import { unwrapFunctionStore, format } from "svelte-i18n";

const $format = unwrapFunctionStore(format);

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const openSelectedFolder = () => {
	openFile(config.detectOptions.selectedFolder);
	closeDialog();
}

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

export const setupI18n = async () => {
	register("en", () => import("../i18n/en.json"));
	register("zh-CN", () => import("../i18n/zh-CN.json"));

	return await Promise.allSettled([
		init({ initialLocale: getLocaleFromNavigator(), fallbackLocale: "en" }),
	]);
};

interface SelectOptions {
	directory?: boolean;
	filters?: { name: string; extensions: string[] }[];
	title: string;
	targetStore: { [key: string]: any };
	targetKey: string;
}

export async function selectPath({
	directory = false,
	filters,
	title,
	targetStore,
	targetKey
}: SelectOptions) {
	try {
		const selected = await open({
			directory,
			multiple: false,
			filters,
			title,
		});

		if (selected) {
			targetStore[targetKey] = Array.isArray(selected) ? selected[0] : selected;
		}
	} catch (err) {
		console.error(`Failed to select ${directory ? 'folder' : 'file'}:`, err);
	}
}


export const selectFolder = () => selectPath({
	directory: true,
	title: "Select Media Folder",
	targetStore: config.detectOptions,
	targetKey: "selectedFolder"
});

export const selectResumePath = () => selectPath({
	filters: [{ name: "Result file", extensions: ["json", "csv"] }],
	title: "Select result file",
	targetStore: config.detectOptions,
	targetKey: "resumePath"
});

export const selectBufferFolder = () => selectPath({
	directory: true,
	title: "Select Buffer Folder",
	targetStore: config.configOptions,
	targetKey: "bufferPath"
});

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
		let config_stored = await store.get("config") as { detectOptions?: typeof config.detectOptions; configOptions?: typeof config.configOptions };
		if (config_stored) {
			config.detectOptions = config_stored.detectOptions || config.detectOptions;
			config.configOptions = config_stored.configOptions || config.configOptions;
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

export async function organize() {
	let command;
	let resultFile = `${config.detectOptions.selectedFolder}/result${config.configOptions.exportFormat === "Json" ? ".json" : ".csv"}`;
	let logFile = `${config.detectOptions.selectedFolder}/organize.log`;
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
			{ encoding: "utf8" },
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
			{ encoding: "utf8" },
		);
	}
	detectStatus.isOrganizing = true;
	const output = await command.execute();
	if (output.code !== 0) {
		detectStatus.isOrganizing = false;
		showDialog($format("dialog.title.Error"), `${$format("dialog.message.organizeFailed")}${logFile}`);
	} else {
		detectStatus.isOrganizing = false;
		showDialog($format("dialog.title.Organize"), `${$format("dialog.message.organizeComplete")}${logFile}`);
	}
}

export async function undo() {
	let resultFile = `${config.detectOptions.selectedFolder}/result${config.configOptions.exportFormat === "Json" ? ".json" : ".csv"}`;
	let logFile = `${config.detectOptions.selectedFolder}/organize.log`;
	let command = Command.sidecar(
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
		{ encoding: "utf8" },
	);
	detectStatus.isUndoOrganizing = true;
	const output = await command.execute();
	if (output.code !== 0) {
		detectStatus.isUndoOrganizing = false;
		showDialog($format("dialog.title.Error"), `${$format("dialog.message.undoFailed")}${logFile}`);
	} else {
		detectStatus.isUndoOrganizing = false;
		showDialog(
			$format("dialog.title.Undo"),
			`${$format("dialog.message.undoComplete")}${logFile}`,
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

function debounce<F extends (...args: any[]) => any>(
	func: F,
	timeout = 500,
): (...args: Parameters<F>) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;

	return (...args: Parameters<F>): void => {
		if (timer) {
			clearTimeout(timer);
		}

		timer = setTimeout(() => {
			func.apply(undefined, args);
		}, timeout);
	};
}
export const debouncedCheckHealth = debounce(checkHealth, 800);

export const debouncedCheckQuota = debounce(checkQuota, 800);