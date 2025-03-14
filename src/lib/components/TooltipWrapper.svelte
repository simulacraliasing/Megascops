<script lang="ts">
    import * as Tooltip from "$lib/components/ui/tooltip";
    import type { SvelteComponent } from "svelte";

    // 定义props
    export let text: string; // tooltip显示的文本
    export let component: typeof SvelteComponent | null = null; // 要包装的组件
    export let componentProps: Record<string, any> = {}; // 传递给组件的属性

    // 如果不传入组件，则可以使用slot
</script>

<Tooltip.Provider>
    <Tooltip.Root>
        <Tooltip.Trigger>
            {#if component}
                <svelte:component this={component} {...componentProps} />
            {:else}
                <slot />
            {/if}
        </Tooltip.Trigger>
        <Tooltip.Content>
            <p>{text}</p>
        </Tooltip.Content>
    </Tooltip.Root>
</Tooltip.Provider>
