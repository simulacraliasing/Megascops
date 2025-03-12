<script lang="ts">
    import * as Tooltip from "$lib/components/ui/tooltip";
    // 定义可能的状态类型
    type StatusType = "online" | "offline" | "unknown";

    // 定义组件属性
    export let status: StatusType = "online";

    // 定义状态配置接口
    interface StatusConfig {
        dotClasses: string;
        pulseClasses: string;
        label: string;
    }

    // 状态配置映射
    const statusMap: Record<StatusType, StatusConfig> = {
        online: {
            dotClasses: "bg-green-500 shadow-md shadow-green-500/60",
            pulseClasses: "bg-green-500/40",
            label: "服务正常",
        },
        unknown: {
            dotClasses: "bg-slate-400",
            pulseClasses: "",
            label: "状态未知",
        },
        offline: {
            dotClasses: "bg-red-500",
            pulseClasses: "",
            label: "服务离线",
        },
    };

    // 响应式获取当前状态配置
    $: config = statusMap[status];
</script>

<div class="flex items-center gap-2">
    <Tooltip.Provider>
        <Tooltip.Root>
            <Tooltip.Trigger class="relative inline-block">
                {#if status !== "offline"}
                    <div
                        class={`absolute top-0 left-0 w-3 h-3 rounded-full ${config.pulseClasses} animate-ping pointer-events-none`}
                    ></div>
                {/if}

                <div
                    class={`w-3 h-3 rounded-full ${config.dotClasses} z-10 relative`}
                ></div>
            </Tooltip.Trigger>
            <Tooltip.Content>
                <span>{config.label}</span>
            </Tooltip.Content>
        </Tooltip.Root>
    </Tooltip.Provider>
</div>
