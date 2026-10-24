export const THEME_STORAGE_KEY = "wf-theme";

/**
 * Inline, render-blocking script: applies the stored theme before first paint.
 * The server renders data-theme="light", so the white theme is the default even on
 * dark-mode devices; dark applies only when chosen, and "system" follows the device.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark")d.setAttribute("data-theme","dark");else if(t==="system")d.removeAttribute("data-theme");}catch(e){}})();`;

/** Class on <html> once the Newsreader serif may be used (app/styles/theme.css). */
export const SERIF_READY_CLASS = "wf-serif";
/** Set after the serif has loaded once, so returning visitors use it from the first paint. */
export const SERIF_STORAGE_KEY = "wf-serif";
/** Font family name next/font gives Newsreader (lib/ui/fonts.ts). */
export const SERIF_FAMILY = "Newsreader";

/**
 * Inline script: keeps the Newsreader serif (82 KB, both faces) off the first paint.
 * Until <html> has SERIF_READY_CLASS, display text uses Newsreader's metric-matched
 * fallback, so the browser never requests the serif before the page has painted.
 * - Returning visitor (flag set): the class goes on before first paint; fonts come from cache.
 * - First visit: once the page has loaded and its first contentful paint is reported, the
 *   upright and italic faces are fetched with document.fonts, then the class goes on and
 *   the headings swap in.
 * Without JS, a <noscript> style in the root layout applies the serif directly.
 */
export const SERIF_BOOT_SCRIPT = `(function(){var d=document.documentElement;function on(){d.classList.add("${SERIF_READY_CLASS}")}try{if(localStorage.getItem("${SERIF_STORAGE_KEY}")==="1"){on();return}}catch(e){}function load(){var f=document.fonts;if(!f||!f.load){on();return}Promise.all([f.load('300 1em "${SERIF_FAMILY}"'),f.load('italic 400 1em "${SERIF_FAMILY}"')]).then(function(){on();try{localStorage.setItem("${SERIF_STORAGE_KEY}","1")}catch(e){}},on)}function afterPaint(){try{if(performance.getEntriesByName("first-contentful-paint").length){load();return}var o=new PerformanceObserver(function(l){if(l.getEntriesByName("first-contentful-paint").length){o.disconnect();load()}});o.observe({type:"paint",buffered:true})}catch(e){load()}}if(document.readyState==="complete")afterPaint();else addEventListener("load",afterPaint,{once:true})})();`;

/** No-JS fallback for SERIF_BOOT_SCRIPT: use the serif straight away. */
export const SERIF_NOSCRIPT_CSS = `html:not(.${SERIF_READY_CLASS}){--font-serif:"${SERIF_FAMILY}","${SERIF_FAMILY} Fallback"}`;
