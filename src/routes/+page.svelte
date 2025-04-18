<script lang="ts">
    import { onMount } from "svelte";
    import { listen } from "@tauri-apps/api/event";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index";
    import { _, isLoading } from "svelte-i18n";
    import {
        showDialog,
        closeDialog,
        checkHealth,
        checkQuota,
        loadConfig,
        debouncedCheckHealth,
        debouncedCheckQuota,
        openSelectedFolder,
        saveConfig,
    } from "$lib/utils";
    import {
        dialogConfig,
        detectStatus,
        config,
        appVersion,
    } from "$lib/store.svelte";
    import { DetectPanel, ConfigPanel } from "$lib/components";
    import { startTour } from "$lib/tour";
    import { getVersion } from "@tauri-apps/api/app";

    listen<boolean>("health-status", (event) => {
        let status = event.payload;
        if (status) {
            detectStatus.serviceStatus = "online";
        } else {
            detectStatus.serviceStatus = "offline";
        }
    });

    listen<number>("detect-progress", (event) => {
        detectStatus.progress = event.payload;
    });

    listen<number>("detect-complete", async (event) => {
        let complete = event.payload;
        if (complete === 1) {
            detectStatus.progress = 100;
            detectStatus.isProcessing = false;
            await checkQuota();
            showDialog(
                $_("dialog.title.Success"),
                $_("dialog.message.processComplete"),
            );
        }
    });

    listen<string>("detect-error", (event) => {
        let error = event.payload;
        detectStatus.isProcessing = false;
        showDialog($_("dialog.title.Error"), error);
    });

    listen<number>("quota", (event) => {
        detectStatus.quota = event.payload;
    });

    $effect(() => {
        if (config.detectOptions.grpcUrl) {
            debouncedCheckHealth();
            debouncedCheckQuota();
        }
        if (config.detectOptions.accessToken) {
            debouncedCheckQuota();
        }
    });

    onMount(async () => {
        appVersion.value = await getVersion();
        await loadConfig();
        checkHealth();
        if (config.firstRun) {
            startTour();
            config.firstRun = false;
            await saveConfig();
        }
    });
</script>

<main class="flex flex-col h-screen w-full">
    {#if $isLoading}
        Please wait...
    {:else}
        <div class="relative flex-1 overflow-auto">
            {#if !detectStatus.showConfig}
                <DetectPanel />
            {:else}
                <ConfigPanel />
            {/if}
        </div>
    {/if}
    <!-- <p style="color: red">{error.message}</p> -->
    <AlertDialog.Root open={dialogConfig.isOpen} onOpenChange={closeDialog}>
        <AlertDialog.Content>
            <AlertDialog.Header>
                <AlertDialog.Title>{dialogConfig.title}</AlertDialog.Title>
                <AlertDialog.Description>
                    {dialogConfig.description}
                </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
                <AlertDialog.Action onclick={openSelectedFolder} class="mr-2"
                    >{$_("dialog.button.openMediaFolder")}</AlertDialog.Action
                >
                <AlertDialog.Action onclick={closeDialog}>OK</AlertDialog.Action
                >
            </AlertDialog.Footer>
        </AlertDialog.Content>
    </AlertDialog.Root>
</main>

<style>
    :global(body) {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        background-color: #f5f5f5;
        color: #333;
        height: 100vh;
    }
</style>
