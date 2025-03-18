import { getLocaleFromNavigator, init, register } from "svelte-i18n";

register("en", () => import("./i18n/en.json"));
register("zh", () => import("./i18n/zh-CN.json"));

init({
    fallbackLocale: "en",
    initialLocale: getLocaleFromNavigator(),
})
