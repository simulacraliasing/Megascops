import { getVersion } from "@tauri-apps/api/app";

export const appVersion = await getVersion();

export const dialogConfig = $state({
    isOpen: false,
    title: "",
    description: "",
});

export const detectStatus = $state({
    progress: 0,
    isProcessing: false,
    showConfig: false,
    configIconAnimating: false,
    showPassword: false,
    isOrganizing: false,
    isUndoOrganizing: false,
    quota: 0,
    serviceStatus: "unknown" as "online" | "offline" | "unknown",
});

export interface DetectOptions {
    selectedFolder: string;
    grpcUrl: string;
    accessToken: string;
    resumePath: string | null;
    guess: boolean;
}

interface ConfigOptions {
    confidenceThreshold: number;
    iouThreshold: number;
    quality: number;
    exportFormat: "Json" | "Csv"; // 可以使用联合类型限制可选值
    bufferPath: string | null;
    bufferSize: number;
    checkPoint: number;
    maxFrames: number;
    iframeOnly: boolean;
}

// 定义主配置接口
export interface Config {
    detectOptions: DetectOptions;
    configOptions: ConfigOptions;
    firstRun: boolean;
}

export const config = $state<Config>({
    detectOptions: {
        selectedFolder: "",
        grpcUrl: "https://md5rs.hinature.cn",
        accessToken: "",
        resumePath: null,
        guess: false,
    },
    configOptions: {
        confidenceThreshold: 0.2,
        iouThreshold: 0.45,
        quality: 70,
        exportFormat: "Json",
        bufferPath: null,
        bufferSize: 20,
        checkPoint: 100,
        maxFrames: 3,
        iframeOnly: true,
    },
    firstRun: true,
});
