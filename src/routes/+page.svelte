<script lang="ts">
  import {
    readTextFile,
    writeTextFile,
    exists,
    create,
    mkdir,
  } from "@tauri-apps/plugin-fs";
  import { appConfigDir } from "@tauri-apps/api/path";
  import { Command } from "@tauri-apps/plugin-shell";
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { open } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { Button, Root } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Select from "$lib/components/ui/select/index";
  import * as Card from "$lib/components/ui/card/index";
  import { Label } from "$lib/components/ui/label/index";
  import { Progress } from "$lib/components/ui/progress/index";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index";
  import { Switch } from "$lib/components/ui/switch/index";
  import { Slider } from "$lib/components/ui/slider/index";
  import { Badge } from "$lib/components/ui/badge/index";
  import { Toggle } from "$lib/components/ui/toggle/index";
  import {
    Folder,
    Bolt,
    Play,
    LoaderCircle,
    EyeOff,
    Eye,
    Shapes,
    Undo2,
    FlaskConical,
  } from "lucide-svelte";
  import { _ } from "svelte-i18n";
  import { getLocaleFromNavigator, init, register } from "svelte-i18n";
  import ConfigSlider from "./ConfigSlider.svelte";
  import StatusIndicator from "./StatusIndicator.svelte";

  async function setup() {
    register("en", () => import("../i18n/en.json"));
    register("zh-CN", () => import("../i18n/zh-CN.json"));

    return await Promise.allSettled([
      init({ initialLocale: getLocaleFromNavigator(), fallbackLocale: "en" }),
    ]);
  }

  const setupResult = setup();

  // State variables
  let selectedFolder = $state("");
  let url = $state("https://md5rs.hinature.cn");
  let accessToken = $state("");
  let resumePath = $state("");
  let progress = $state(0);
  let isProcessing = $state(false);
  let showConfig = $state(false);
  let configIconAnimating = $state(false);
  let showPassword = $state(false);
  let guess = $state(false);
  let isOrganizing = $state(false);
  let isUndoOrganizing = $state(false);
  let quota = $state("");

  let serviceStatus: "online" | "offline" | "unknown" = $state("unknown");

  const dialogConfig = writable({
    isOpen: false,
    title: "",
    description: "",
  });

  const showDialog = (title: string, description: string) => {
    dialogConfig.set({ isOpen: true, title, description });
  };

  const closeDialog = () => {
    dialogConfig.update((config) => ({ ...config, isOpen: false }));
  };

  // Config options
  let configOptions = $state({
    confidenceThreshold: 0.2,
    iouThreshold: 0.45,
    quality: 70,
    exportFormat: "Json",
    bufferPath: "",
    bufferSize: 20,
    checkPoint: 100,
    maxFrames: 3,
    iframeOnly: true,
  });

  // Select folder handler
  async function selectFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Media Folder",
      });

      if (selected) {
        selectedFolder = Array.isArray(selected) ? selected[0] : selected;
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  }

  async function selectResumePath() {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Result file",
            extensions: ["json", "csv"],
          },
        ],
        title: "Select result file",
      });

      if (selected) {
        resumePath = Array.isArray(selected) ? selected[0] : selected;
      }
    } catch (err) {
      console.error("Failed to select result file:", err);
    }
  }

  async function selectBufferFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Buffer Folder",
      });

      if (selected) {
        configOptions.bufferPath = Array.isArray(selected)
          ? selected[0]
          : selected;
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  }

  listen<boolean>("health-status", (event) => {
    let status = event.payload;
    if (status) {
      serviceStatus = "online";
    } else {
      serviceStatus = "offline";
    }
  });

  listen<number>("detect-progress", (event) => {
    progress = event.payload;
  });

  listen<number>("detect-complete", async (event) => {
    let complete = event.payload;
    if (complete === 1) {
      progress = 100;
      isProcessing = false;
      await checkQuota();
      showDialog(
        $_("dialog.title.Success"),
        $_("dialog.message.processComplete"),
      );
    }
  });

  listen<string>("detect-error", (event) => {
    let error = event.payload;
    isProcessing = false;
    showDialog($_("dialog.title.Error"), error);
  });

  listen<number>("quota", (event) => {
    quota = formatQuota(event.payload);
  });

  function formatQuota(quota: number): string {
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

  async function checkHealth() {
    try {
      await invoke("check_health", { grpcUrl: url });
    } catch (err) {
      console.error("Health check failed:", err);
    }
  }

  async function checkQuota() {
    try {
      await invoke("check_quota", { grpcUrl: url, token: accessToken });
      console.log("Quota checked");
    } catch (err) {
      console.error("Auth failed:", err);
    }
  }

  // Start processing handler
  async function startProcessing() {
    if (!selectedFolder) {
      alert("Please select a folder first");
      return;
    }

    await saveConfig();

    isProcessing = true;
    progress = 0;

    try {
      let config = {
        folder: selectedFolder,
        url: url,
        token: accessToken,
        max_frames: configOptions.maxFrames,
        iframe_only: configOptions.iframeOnly,
        iou: configOptions.iouThreshold,
        conf: configOptions.confidenceThreshold,
        quality: configOptions.quality,
        export: configOptions.exportFormat,
        checkpoint: configOptions.checkPoint,
        resume_from: null,
        buffer_path: null,
        buffer_size: configOptions.bufferSize,
      };

      console.log("Starting processing with config:", config);

      await invoke("process_media", {
        config,
      });

      console.log("Processing complete");
    } catch (err) {
      console.error("Processing failed:", err);
      isProcessing = false;
    }
  }

  async function saveConfig() {
    try {
      const configDir = await appConfigDir();
      const dirExists = await exists(configDir);
      if (!dirExists) {
        await mkdir(configDir, { recursive: true });
        console.log(`Created directory: ${configDir}`);
      }
      const configPath = `${configDir}/config.json`;
      await create(configPath);

      const configData = {
        general: {
          selectedFolder,
          url,
          accessToken,
          resumePath,
        },
        detection: {
          confidenceThreshold: configOptions.confidenceThreshold,
          iouThreshold: configOptions.iouThreshold,
          quality: configOptions.quality,
          exportFormat: configOptions.exportFormat,
          bufferPath: configOptions.bufferPath,
          bufferSize: configOptions.bufferSize,
          checkPoint: configOptions.checkPoint,
          maxFrames: configOptions.maxFrames,
          iframeOnly: configOptions.iframeOnly,
        },
      };

      // Convert to JSON string
      const jsonContent = JSON.stringify(configData, null, 2);
      await writeTextFile(configPath, jsonContent);
      console.log("Configuration saved successfully");
    } catch (err) {
      console.error("Failed to save configuration:", err);
    }
  }

  async function loadConfig() {
    try {
      const configDir = await appConfigDir();
      const configPath = `${configDir}/config.json`;

      const fileExists = await exists(configPath);
      if (!fileExists) {
        console.log("No configuration file found, using defaults");
        return;
      }

      const configContent = await readTextFile(configPath);
      // Parse JSON content
      const config = JSON.parse(configContent);

      // Load general settings
      if (config.general) {
        selectedFolder = config.general.selectedFolder || "";
        url = config.general.url || "https://md5rs.hinature.cn";
        accessToken = config.general.accessToken || "";
        resumePath = config.general.resumePath || "";
      }

      // Load detection settings
      if (config.detection) {
        configOptions = {
          confidenceThreshold: config.detection.confidenceThreshold ?? 0.2,
          iouThreshold: config.detection.iouThreshold ?? 0.45,
          quality: config.detection.quality ?? 70,
          exportFormat: config.detection.exportFormat ?? "Json",
          bufferPath: config.detection.bufferPath ?? "",
          bufferSize: config.detection.bufferSize ?? 20,
          checkPoint: config.detection.checkPoint ?? 100,
          maxFrames: config.detection.maxFrames ?? 3,
          iframeOnly: config.detection.iframeOnly ?? true,
        };
      }

      console.log("Configuration loaded successfully");
    } catch (err) {
      console.error("Failed to load configuration:", err);
    }
  }

  // Toggle config panel
  async function toggleConfig() {
    showConfig = !showConfig;
    configIconAnimating = true;
    console.log(showConfig);
    setTimeout(() => {
      configIconAnimating = false;
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
  const debouncedCheckHealth = debounce(checkHealth, 800);

  const debouncedCheckQuota = debounce(checkQuota, 800);

  async function organize() {
    let command;
    let resultFile = `${selectedFolder}/result${configOptions.exportFormat === "Json" ? ".json" : ".csv"}`;
    let logFile = `${selectedFolder}/organize.log`;
    if (guess) {
      command = Command.sidecar("binaries/organize", [
        "--result",
        resultFile,
        "--mode",
        "guess",
        "--log-level",
        "INFO",
        "--log-file",
        logFile,
      ]);
    } else {
      command = Command.sidecar("binaries/organize", [
        "--result",
        resultFile,
        "--mode",
        "default",
        "--log-level",
        "INFO",
        "--log-file",
        logFile,
      ]);
    }
    isOrganizing = true;
    const output = await command.execute();
    if (output.code !== 0) {
      isOrganizing = false;
      showDialog("Error", "Failed to organize");
    } else {
      isOrganizing = false;
      showDialog("Organize", `Organize complete, see details in ${logFile}`);
    }
  }

  async function undo() {
    let resultFile = `${selectedFolder}/result${configOptions.exportFormat === "Json" ? ".json" : ".csv"}`;
    let logFile = `${selectedFolder}/organize.log`;
    let command = Command.sidecar("binaries/organize", [
      "--result",
      resultFile,
      "--mode",
      "undo",
      "--log-level",
      "INFO",
      "--log-file",
      logFile,
    ]);
    isUndoOrganizing = true;
    const output = await command.execute();
    if (output.code !== 0) {
      isUndoOrganizing = false;
      showDialog("Error", "Failed to undo organize");
    } else {
      isUndoOrganizing = false;
      showDialog(
        "Organize",
        `Undo organize complete, see details in ${logFile}`,
      );
    }
    console.log(output);
  }

  $effect(() => {
    if (url) {
      debouncedCheckHealth();
      debouncedCheckQuota();
    }
    if (accessToken) {
      debouncedCheckQuota();
    }
  });

  onMount(async () => {
    await setupResult;
    await loadConfig();
    checkHealth();
  });
</script>

<main class="flex flex-col h-screen w-full">
  {#await setupResult}
    <div>Loading...</div>
  {:then}
    <div class="relative flex-1 overflow-auto">
      {#if !showConfig}
        <Card.Root class="h-full w-full m-0 rounded-none shadow-none">
          <Card.Header class="flex justify-between items-center flex-row">
            <Card.Title>{$_("title.detect")}</Card.Title>
            <Button
              variant="ghost"
              size="icon"
              onclick={toggleConfig}
              disabled={isProcessing}
              class="config-button"
            >
              <div class={configIconAnimating ? "spin-animation-open" : ""}>
                <Bolt style="width: 1.5rem; height: 1.5rem;" />
              </div>
            </Button>
          </Card.Header>
          <Card.Content class="flex flex-col gap-6">
            <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-2 col-span-full">
                <Label for="folder">{$_("detect.folder")}</Label>
                <div class="flex gap-2">
                  <Input
                    type="text"
                    id="folder"
                    bind:value={selectedFolder}
                    placeholder="No folder selected"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onclick={selectFolder}
                    disabled={isProcessing}
                  >
                    <Folder />
                  </Button>
                </div>
              </div>
              <div class="flex flex-col gap-2 col-span-full">
                <Label for="url">{$_("detect.url")}</Label>
                <div class="flex items-center gap-2">
                  <div class="flex-grow">
                    <Input
                      type="text"
                      id="url"
                      bind:value={url}
                      placeholder=""
                    />
                  </div>
                  <div class="m-3">
                    <StatusIndicator status={serviceStatus} />
                  </div>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <Label for="access-token">{$_("detect.token")}</Label>
                <div class="flex items-center gap-2">
                  <div class="relative flex-grow">
                    <Input
                      type={showPassword ? "text" : "password"}
                      id="access-token"
                      bind:value={accessToken}
                      placeholder=""
                      class="pr-10 w-full"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      class="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onclick={() => (showPassword = !showPassword)}
                    >
                      {#if showPassword}
                        <Eye class="h-4 w-4" />
                      {:else}
                        <EyeOff class="h-4 w-4" />
                      {/if}
                    </Button>
                  </div>
                  <Badge>{quota}</Badge>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <Label for="resume-path">{$_("detect.resumePath")}</Label>
                <div class="flex gap-2">
                  <Input
                    type="text"
                    id="resume-path"
                    bind:value={resumePath}
                    placeholder="No file selected"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onclick={selectResumePath}
                    disabled={isProcessing}
                  >
                    <Folder />
                  </Button>
                </div>
              </div>
            </section>
            <Progress value={progress} max={100} />
            <div class="flex items-center relative">
              <!-- Toggle 在左侧 -->
              <Toggle size="sm" aria-label="Toggle guess" bind:pressed={guess}>
                <FlaskConical class="h-4 w-4" />
              </Toggle>

              <!-- 三个按钮作为整体居中 -->
              <div
                class="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-2"
              >
                <div class="flex items-center">
                  <Button variant="ghost" size="icon" onclick={organize}>
                    {#if isOrganizing}
                      <LoaderCircle
                        class="animate-spin"
                        style="width: 1.2rem; height: 1.2rem;"
                      />
                    {:else}
                      <Shapes style="width: 1.2rem; height: 1.2rem;" />
                    {/if}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onclick={startProcessing}
                    disabled={isProcessing ||
                      !selectedFolder ||
                      !url ||
                      !accessToken ||
                      serviceStatus !== "online"}
                  >
                    {#if isProcessing}
                      <LoaderCircle
                        class="animate-spin"
                        style="width: 1.5rem; height: 1.5rem;"
                      />
                    {:else}
                      <Play style="width: 1.5rem; height: 1.5rem;" />
                    {/if}
                  </Button>

                  <Button variant="ghost" size="icon" onclick={undo}>
                    {#if isUndoOrganizing}
                      <LoaderCircle
                        class="animate-spin"
                        style="width: 1.2rem; height: 1.2rem;"
                      />
                    {:else}
                      <Undo2 style="width: 1.2rem; height: 1.2rem;" />
                    {/if}
                  </Button>
                </div>
              </div>
            </div>
          </Card.Content>
        </Card.Root>
      {:else}
        <Card.Root class="h-full w-full m-0 rounded-none shadow-none">
          <Card.Header class="flex flex-row items-center justify-between">
            <Card.Title>{$_("title.config")}</Card.Title>
            <Button
              variant="ghost"
              size="icon"
              onclick={toggleConfig}
              class="config-button"
            >
              <div
                class={configIconAnimating
                  ? !showConfig
                    ? "spin-animation-open"
                    : "spin-animation-close"
                  : ""}
              >
                <Bolt style="width: 1.5rem; height: 1.5rem;" />
              </div>
            </Button>
          </Card.Header>
          <Card.Content>
            <div
              class="grid grid-cols-1 sm:grid-cols-2 gap-6 flex-1 overflow-auto"
            >
              <ConfigSlider
                id="confidence"
                label={$_("config.confidence")}
                min={0.1}
                max={1}
                step={0.05}
                bind:value={configOptions.confidenceThreshold}
              />

              <ConfigSlider
                id="iou"
                label={$_("config.iou")}
                min={0.1}
                max={1}
                step={0.05}
                bind:value={configOptions.iouThreshold}
              />

              <ConfigSlider
                id="quality"
                label={$_("config.quality")}
                min={10}
                max={100}
                step={5}
                bind:value={configOptions.quality}
              />
              <div class="flex flex-col gap-3">
                <Label for="max-frames">{$_("config.maxFrames")}</Label>
                <div class="flex items-center gap-2">
                  <div class="flex-grow">
                    <Slider
                      type="single"
                      id="max-frames"
                      min={0}
                      max={15}
                      step={1}
                      bind:value={configOptions.maxFrames}
                    />
                  </div>
                  <span class="ml-1 min-w-1 text-right"
                    >{configOptions.maxFrames}</span
                  >
                  <div class="flex gap-2 w-auto items-center">
                    <Switch bind:checked={configOptions.iframeOnly} />
                    <Label for="iframe-only">{$_("config.iframeOnly")}</Label>
                  </div>
                </div>
              </div>

              <div class="config-item">
                <Label for="export-format">{$_("config.exportFormat")}</Label>
                <Select.Root
                  type="single"
                  bind:value={configOptions.exportFormat}
                >
                  <Select.Trigger>{configOptions.exportFormat}</Select.Trigger>
                  <Select.Content>
                    <Select.Item value="Json" label="JSON" />
                    <Select.Item value="Csv" label="CSV" />
                  </Select.Content>
                </Select.Root>
              </div>

              <div class="config-item">
                <Label for="buffer-path">{$_("config.bufferPath")}</Label>
                <div class="flex items-center gap-2">
                  <div class="flex-grow">
                    <Input
                      type="text"
                      id="folder"
                      readonly
                      bind:value={configOptions.bufferPath}
                      placeholder="No folder selected"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onclick={selectBufferFolder}
                    disabled={isProcessing}
                  >
                    <Folder />
                  </Button>
                </div>
              </div>

              <ConfigSlider
                id="buffer-size"
                label={$_("config.bufferSize")}
                min={0}
                max={50}
                step={5}
                bind:value={configOptions.bufferSize}
              />

              <ConfigSlider
                id="checkpoint"
                label={$_("config.checkPoint")}
                min={0}
                max={1000}
                step={50}
                bind:value={configOptions.checkPoint}
              />
            </div>
          </Card.Content>
        </Card.Root>
      {/if}
    </div>
  {:catch error}
    <!-- <p style="color: red">{error.message}</p> -->
  {/await}
  <AlertDialog.Root open={$dialogConfig.isOpen} onOpenChange={closeDialog}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>{$dialogConfig.title}</AlertDialog.Title>
        <AlertDialog.Description>
          {$dialogConfig.description}
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Action onclick={closeDialog}>OK</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
      Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
    background-color: #f5f5f5;
    color: #333;
    height: 100vh;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes spin-open {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(180deg);
    }
  }

  @keyframes spin-close {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(-180deg);
    }
  }

  .spin-animation-open {
    animation: spin-open 0.5s ease-in-out;
  }

  .spin-animation-close {
    animation: spin-close 0.5s ease-in-out;
  }
</style>
