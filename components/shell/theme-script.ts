export const THEME_STORAGE_KEY = "wf-theme";

/** Inline, render-blocking script: applies the stored theme before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;
