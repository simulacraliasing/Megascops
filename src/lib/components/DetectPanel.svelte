<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index";
  import { Toggle } from "$lib/components/ui/toggle/index";
  import { Progress } from "$lib/components/ui/progress/index";
  import * as Card from "$lib/components/ui/card/index";
  import { Label } from "$lib/components/ui/label/index";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import StatusIndicator from "$lib/components/StatusIndicator.svelte";
  import TooltipWrapper from "$lib/components/TooltipWrapper.svelte";
  import { _ } from "svelte-i18n";
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
    CircleHelp,
  } from "lucide-svelte";
  import {
    selectFolder,
    selectResumePath,
    startProcessing,
    organize,
    undo,
    toggleConfig,
  } from "$lib/utils";
  import { detectStatus, config } from "$lib/store.svelte";
  import Shepherd from "shepherd.js";
  import "../../shepherd.css";
  import { offset } from "@floating-ui/dom";
  import TooltipContent from "./ui/tooltip/tooltip-content.svelte";

  interface SimpleTourStepConfig {
    id: string;
    position?: "top" | "right" | "bottom" | "left";
  }

  interface TourButton {
    text: string;
    action: () => void;
  }

  interface TourAttachment {
    element: string;
    on: "auto" | "top" | "right" | "bottom" | "left";
  }

  interface TourStep {
    id: string;
    text: string;
    buttons: TourButton[];
    attachTo: TourAttachment;
  }

  function toCamel(str: string): string {
    return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  function generateTourSteps(stepsConfig: SimpleTourStepConfig[]): TourStep[] {
    return stepsConfig.map((config) => {
      const camelCaseId = toCamel(config.id);
      const next_action = async () => {
        if (config.id === "config-button") {
          await toggleConfig();
          tour.next();
        } else {
          tour.next();
        }
      };

      const back_action = async () => {
        if (config.id === "confidence") {
          await toggleConfig();
          tour.back();
        } else {
          tour.back();
        }
      };

      return {
        id: `tour-${config.id}`,
        text: $_(`tour.${camelCaseId}`),
        buttons: [
          {
            text: $_("tour.button.cancel"),
            action: tour.cancel,
          },
          {
            text: $_("tour.button.back"),
            action: back_action,
          },
          {
            text: $_("tour.button.next"),
            action: next_action,
            classes: "shepherd-button-primary",
          },
        ],
        attachTo: {
          element: `#${config.id}`,
          on: config.position || "bottom",
        },
        modalOverlayOpeningPadding: 6,
        floatingUIOptions: {
          middleware: [offset({ mainAxis: 18, crossAxis: -18 })],
        },
      };
    });
  }

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      classes: "shepherd-shadcn-theme",
      scrollTo: false,
    },
  });

  tour.addStep({
    id: "help",
    text: $_("tour.help"),
    buttons: [
      {
        text: $_("tour.button.cancel"),
        action: tour.cancel,
      },
      {
        text: $_("tour.button.next"),
        action: tour.next,
        classes: "shepherd-button-primary",
      },
    ],
    attachTo: {
      element: "#help",
      on: "bottom",
    },
    floatingUIOptions: {
      middleware: [offset({ mainAxis: 18, crossAxis: -18 })],
    },
  });

  const tourSteps = generateTourSteps([
    { id: "media-folder" },
    { id: "grpc-url" },
    { id: "service-status" },
    { id: "access-token" },
    { id: "quota", position: "top" },
    { id: "resume-path", position: "top" },
    { id: "progress", position: "top" },
    { id: "guess", position: "top" },
    { id: "organize", position: "top" },
    { id: "start", position: "top" },
    { id: "undo", position: "top" },
    { id: "config-button", position: "bottom" },
    { id: "confidence" },
    { id: "iou" },
    { id: "quality" },
    { id: "max-frames" },
    { id: "iframe-only" },
    { id: "export-format", position: "top" },
    { id: "buffer-path", position: "top" },
    { id: "buffer-size", position: "top" },
  ]);

  tour.addSteps(tourSteps);

  tour.addStep({
    id: "check-point",
    text: $_("tour.checkPoint"),
    buttons: [
      {
        text: $_("tour.button.back"),
        action: tour.back,
      },
      {
        text: $_("tour.button.done"),
        action: tour.next,
        classes: "shepherd-button-primary",
      },
    ],
    attachTo: {
      element: "#check-point",
      on: "top",
    },
    modalOverlayOpeningPadding: 6,
    floatingUIOptions: {
      middleware: [offset({ mainAxis: 18, crossAxis: -18 })],
    },
  });

  function startTour() {
    tour.start();
  }
</script>

<Card.Root class="h-full w-full m-0 rounded-none shadow-none">
  <Card.Header class="flex justify-between items-center flex-row">
    <Card.Title>{$_("title.detect")}</Card.Title>
    <div>
      <TooltipWrapper text={$_("tooltip.help")}>
        <Button
          id="help"
          variant="ghost"
          size="icon"
          onclick={startTour}
          disabled={detectStatus.isProcessing}
        >
          <CircleHelp style="width: 1.5rem; height: 1.5rem;" />
        </Button>
      </TooltipWrapper>
      <TooltipWrapper text={$_("tooltip.config")}>
        <Button
          id="config-button"
          variant="ghost"
          size="icon"
          onclick={toggleConfig}
          disabled={detectStatus.isProcessing}
          class="config-button"
        >
          <div
            class={detectStatus.configIconAnimating
              ? "spin-animation-open"
              : ""}
          >
            <Bolt style="width: 1.5rem; height: 1.5rem;" />
          </div>
        </Button>
      </TooltipWrapper>
    </div>
  </Card.Header>
  <Card.Content class="flex flex-col gap-6">
    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div id="media-folder" class="flex flex-col gap-2 col-span-full">
        <Label for="folder">{$_("detect.folder")}</Label>
        <div class="flex gap-2">
          <Input
            type="text"
            id="folder"
            bind:value={config.detectOptions.selectedFolder}
            placeholder="No folder selected"
          />
          <Button
            variant="outline"
            size="icon"
            onclick={selectFolder}
            disabled={detectStatus.isProcessing}
          >
            <Folder />
          </Button>
        </div>
      </div>
      <div id="grpc-url" class="flex flex-col gap-2 col-span-full">
        <Label>{$_("detect.url")}</Label>
        <div class="flex items-center gap-2">
          <div class="flex-grow">
            <Input
              type="text"
              bind:value={config.detectOptions.grpcUrl}
              placeholder=""
            />
          </div>
          <div id="service-status" class="m-3">
            <StatusIndicator status={detectStatus.serviceStatus} />
          </div>
        </div>
      </div>

      <div id="access-token" class="flex flex-col gap-2">
        <Label>{$_("detect.token")}</Label>
        <div class="flex items-center gap-2">
          <div class="relative flex-grow">
            <Input
              type={detectStatus.showPassword ? "text" : "password"}
              bind:value={config.detectOptions.accessToken}
              placeholder=""
              class="pr-10 w-full"
            />
            <Button
              type="button"
              variant="ghost"
              class="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
              onclick={() =>
                (detectStatus.showPassword = !detectStatus.showPassword)}
            >
              {#if detectStatus.showPassword}
                <Eye class="h-4 w-4" />
              {:else}
                <EyeOff class="h-4 w-4" />
              {/if}
            </Button>
          </div>
          <Badge id="quota">{detectStatus.quota}</Badge>
        </div>
      </div>

      <div id="resume-path" class="flex flex-col gap-2">
        <Label>{$_("detect.resumePath")}</Label>
        <div class="flex gap-2">
          <Input
            type="text"
            bind:value={config.detectOptions.resumePath}
            placeholder="No file selected"
          />
          <Button
            variant="outline"
            size="icon"
            onclick={selectResumePath}
            disabled={detectStatus.isProcessing}
          >
            <Folder />
          </Button>
        </div>
      </div>
    </section>
    <div id="progress">
      <Progress value={detectStatus.progress} max={100} />
    </div>
    <div class="flex items-center relative">
      <TooltipWrapper text={$_("tooltip.guess")}>
        <Toggle
          id="guess"
          size="sm"
          aria-label="Toggle guess"
          bind:pressed={config.detectOptions.guess}
        >
          <FlaskConical class="h-4 w-4" />
        </Toggle>
      </TooltipWrapper>

      <div
        class="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-2"
      >
        <div class="flex items-center">
          <TooltipWrapper text={$_("tooltip.organize")}>
            <Button
              id="organize"
              variant="ghost"
              size="icon"
              onclick={organize}
              disabled={detectStatus.isProcessing ||
                !config.detectOptions.selectedFolder}
            >
              {#if detectStatus.isOrganizing}
                <LoaderCircle
                  class="animate-spin"
                  style="width: 1.2rem; height: 1.2rem;"
                />
              {:else}
                <Shapes style="width: 1.2rem; height: 1.2rem;" />
              {/if}
            </Button>
          </TooltipWrapper>

          <TooltipWrapper text={$_("tooltip.start")}>
            <Button
              id="start"
              variant="ghost"
              size="icon"
              onclick={startProcessing}
              disabled={detectStatus.isProcessing ||
                !config.detectOptions.selectedFolder ||
                !config.detectOptions.grpcUrl ||
                !config.detectOptions.accessToken ||
                detectStatus.serviceStatus !== "online"}
            >
              {#if detectStatus.isProcessing}
                <LoaderCircle
                  class="animate-spin"
                  style="width: 1.5rem; height: 1.5rem;"
                />
              {:else}
                <Play style="width: 1.5rem; height: 1.5rem;" />
              {/if}
            </Button>
          </TooltipWrapper>

          <TooltipWrapper text={$_("tooltip.undo")}>
            <Button
              id="undo"
              variant="ghost"
              size="icon"
              onclick={undo}
              disabled={detectStatus.isProcessing ||
                !config.detectOptions.selectedFolder}
            >
              {#if detectStatus.isUndoOrganizing}
                <LoaderCircle
                  class="animate-spin"
                  style="width: 1.2rem; height: 1.2rem;"
                />
              {:else}
                <Undo2 style="width: 1.2rem; height: 1.2rem;" />
              {/if}
            </Button>
          </TooltipWrapper>
        </div>
      </div>
    </div>
  </Card.Content>
</Card.Root>

<style>
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

  .spin-animation-open {
    animation: spin-open 0.5s ease-in-out;
  }
</style>
