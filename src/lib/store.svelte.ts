export let dialogConfig =
    $state({
        isOpen: false,
        title: "",
        description: "",
    }
    );

export let detectStatus = $state({
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

export let config = $state({
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
    }
})