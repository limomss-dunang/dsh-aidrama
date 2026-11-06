/** 短剧工坊样式：用 DSH 主题 token，明暗自动跟随；不引入 UI 框架。 */

export const VIEW_SELECTOR = '[data-aidrama-view]'
export const ACTIVE_ATTR = 'data-aidrama-active'
export const ENTRY_ATTR = 'data-aidrama-entry'
export const ENTRY_HOST_ATTR = 'data-aidrama-entry-host'

export function shellStyle(): string {
  return `
${VIEW_SELECTOR}{
  display:none;min-width:0;min-height:0;grid-column:1;grid-row:1;
  background:transparent;color:inherit;
  z-index:60;overflow:hidden;
}
html[${ACTIVE_ATTR}] :is([data-pane="conversation"],[class*="centerCol"]){
  position:relative;display:grid!important;grid-template-columns:minmax(0,1fr);
  grid-template-rows:minmax(0,1fr);overflow:hidden;
}
html[${ACTIVE_ATTR}] ${VIEW_SELECTOR}{display:flex!important}
html[${ACTIVE_ATTR}] :is([data-pane="conversation"],[class*="centerCol"])>:not(${VIEW_SELECTOR}){display:none!important}

/* ---------- 侧边栏入口 ---------- */
[${ENTRY_HOST_ATTR}]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;padding:3px;
  border:1px solid color-mix(in srgb,currentColor 17%,transparent);border-radius:10px;margin:2px 0}
[data-dsh-imagegen-session-tabs]:has([${ENTRY_ATTR}]){grid-template-columns:repeat(3,minmax(0,1fr))}
[${ENTRY_ATTR}],[${ENTRY_HOST_ATTR}]>button{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:0;height:30px;padding:0 8px;
  border:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 16%,transparent))!important;
  border-radius:8px;
  background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,currentColor 7%,transparent))!important;
  color:var(--dsw-alias-label-primary,inherit)!important;
  -webkit-text-fill-color:currentColor;
  cursor:pointer;font:inherit;font-size:12px;white-space:nowrap;transition:background .15s,color .15s;
}
[${ENTRY_ATTR}]:hover,[${ENTRY_HOST_ATTR}]>button:hover{
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b6ef6) 14%,var(--dsw-alias-bg-layer-2,transparent))!important;
  color:var(--dsw-alias-label-primary,inherit)!important;
}
[${ENTRY_ATTR}][data-active]{
  background:var(--dsw-alias-brand-primary,#3b6ef6)!important;
  color:#fff!important;-webkit-text-fill-color:#fff;font-weight:600;
  border-color:transparent!important;
}
[data-sidebar-collapsed] [${ENTRY_ATTR}]{width:34px;height:34px;padding:0}
[data-sidebar-collapsed] .ad-entry-label{display:none}

.ad-root {
  --ad-gap: 10px;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1.55;
  letter-spacing: .01em;
}
.ad-root * { box-sizing: border-box; }
.ad-root button, .ad-root input, .ad-root select, .ad-root textarea { font: inherit; color: inherit; }
.ad-top {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: none;
  padding: 10px 18px; border-bottom: 1px solid color-mix(in srgb, currentColor 17%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
}
.ad-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ad-brand-mark {
  width: 30px; height: 30px; border-radius: 9px; flex: none; display: grid; place-items: center;
  color: #fff; font-size: 13px; font-weight: 700;
  background: linear-gradient(135deg, #3b6ef6, #7b46f0);
  box-shadow: 0 4px 12px rgba(59,110,246,.28);
}
.ad-brand-text { display: flex; flex-direction: column; min-width: 0; }
.ad-brand-text strong { font-size: 14px; font-weight: 680; letter-spacing: .2px; white-space: nowrap; }
.ad-brand-text span { color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ad-spacer { flex: 1; }
.ad-body {
  display: grid; grid-template-columns: 208px minmax(0, 1fr) 320px;
  min-height: 0; flex: 1;
}
.ad-rail {
  border-right: 1px solid color-mix(in srgb, currentColor 17%, transparent);
  background: color-mix(in srgb, currentColor 3%, transparent);
  padding: 12px 10px; overflow: auto;
}
.ad-rail button {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 8px 9px; margin: 2px 0; border: 0; border-radius: 9px;
  background: transparent; cursor: pointer; text-align: left; font-size: 12.5px;
}
.ad-rail button:hover { background: color-mix(in srgb, currentColor 9%, transparent); }
.ad-rail button[data-active="true"] {
  background: color-mix(in srgb, currentColor 9%, transparent);
  color: inherit;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 17%, transparent);
}
.ad-rail .ad-rail-idx {
  width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
  font-size: 10px; background: rgba(127,127,127,.16);
}
.ad-rail button[data-active="true"] .ad-rail-idx { background: rgba(127,127,127,.22); color: inherit; }
.ad-rail .ad-rail-meta { margin-left: auto; font-size: 10px; opacity: .7; }
.ad-rail .ad-rail-title { margin: 0 0 8px; padding: 0 8px; font-size: 10.5px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 55%, transparent)); }
.ad-rail .ad-rail-hint { padding: 8px; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); }
.ad-main { overflow: auto; padding: 20px 22px 48px; min-width: 0; max-width: 1440px; width: 100%; margin: 0 auto; }
.ad-side {
  border-left: 1px solid color-mix(in srgb, currentColor 17%, transparent);
  padding: 14px 14px 40px; overflow: auto;
  background: color-mix(in srgb, currentColor 3%, transparent);
}
.ad-body[data-inspector="closed"] { grid-template-columns: 208px minmax(0, 1fr) 42px; }
.ad-side-collapsed { padding: 12px 5px; overflow: hidden; }
.ad-side-collapsed .ad-row { flex-direction: column; gap: 8px; }
.ad-side-collapsed .ad-spacer { display: none; }
.ad-side-collapsed .ad-btn { padding: 0 4px; }
.ad-h1 { font-size: 17px; font-weight: 680; letter-spacing: -.01em; margin: 0 0 2px; }
.ad-h2 { font-size: 13.5px; font-weight: 650; margin: 18px 0 8px; display: flex; align-items: center; gap: 8px; }
.ad-sub { color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); font-size: 12px; margin: 0 0 14px; }
.ad-muted { color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); }
.ad-tiny { font-size: 11px; }
.ad-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ad-col { display: flex; flex-direction: column; gap: 8px; }
.ad-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ad-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ad-card {
  border: 1px solid color-mix(in srgb, currentColor 17%, transparent);
  border-radius: 12px; padding: 14px 16px; background: color-mix(in srgb, currentColor 4%, transparent);
}
.ad-card[data-clickable="true"] { cursor: pointer; }
.ad-card[data-clickable="true"]:hover { border-color: color-mix(in srgb, currentColor 30%, transparent); }
.ad-card-title { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 12.5px; }
.ad-card-title .ad-id { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); }
.ad-card-body { margin-top: 6px; color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); font-size: 12px; white-space: pre-wrap; }
.ad-textarea { width: 100%; min-height: 90px; resize: vertical; padding: 8px 10px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, currentColor 5%, transparent);
  color: inherit; -webkit-text-fill-color: currentColor; }
.ad-input { width: 100%; padding: 7px 9px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, currentColor 5%, transparent);
  color: inherit; -webkit-text-fill-color: currentColor; }
.ad-select { padding: 6px 8px; border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, currentColor 5%, transparent); color: inherit; max-width: 100%; }
.ad-input:focus, .ad-textarea:focus, .ad-select:focus { outline: none; border-color: #3b6ef6;
  box-shadow: 0 0 0 3px rgba(59,110,246,.16); }
.ad-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.ad-label > span { color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); font-size: 11.5px; font-weight: 600; }
.ad-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px;
  padding: 0 12px; border-radius: 8px; box-sizing: border-box;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  background: color-mix(in srgb, currentColor 6%, transparent);
  color: inherit !important;
  -webkit-text-fill-color: currentColor;
  font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background .15s, border-color .15s;
}
.ad-btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 12%, transparent); border-color: color-mix(in srgb, currentColor 34%, transparent); }
.ad-btn[data-kind="primary"] { background: #3b6ef6; border-color: #3b6ef6; color: #fff !important; -webkit-text-fill-color: #fff; }
.ad-btn[data-kind="primary"]:hover:not(:disabled) { background: #3f6ff0; border-color: #3f6ff0; }
.ad-btn[data-kind="danger"] { color: #e5484d !important; border-color: color-mix(in srgb, #e5484d 45%, transparent); background: color-mix(in srgb, #e5484d 8%, transparent); -webkit-text-fill-color: currentColor; }
.ad-btn[data-kind="ghost"] { border-color: transparent; background: transparent; }
.ad-btn:disabled { opacity: .48; cursor: not-allowed; }
.ad-badge { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px;
  font-size: 10px; border: 1px solid var(--dsw-alias-border-l2, #ccc); white-space: nowrap; }
.ad-badge[data-level="error"] { color: var(--dsw-alias-state-error-primary, #c33); border-color: currentColor; }
.ad-badge[data-level="warn"] { color: var(--dsw-alias-state-warn-primary, #b80); border-color: currentColor; }
.ad-badge[data-level="ok"] { color: var(--dsw-alias-state-success-primary, #2a7); border-color: currentColor; }
.ad-badge[data-level="info"] { color: var(--dsw-alias-label-secondary, #777); }
.ad-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ad-table th, .ad-table td { text-align: left; padding: 8px 9px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); vertical-align: top; }
.ad-table th { color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); font-weight: 600; font-size: 11px; position: sticky; top: 0; background: color-mix(in srgb, currentColor 4%, transparent); backdrop-filter: blur(6px); }
.ad-table tr[data-clickable="true"] { cursor: pointer; }
.ad-table tr[data-clickable="true"]:hover td { background: color-mix(in srgb, currentColor 6%, transparent); }
.ad-table tr[data-selected="true"] td { background: color-mix(in srgb, #3b6ef6 10%, transparent); }
.ad-code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; white-space: pre-wrap;
  background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 10px; padding: 10px 12px; margin: 0;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent); max-height: 280px; overflow: auto;
}
.ad-findings { display: flex; flex-direction: column; gap: 6px; }
.ad-finding { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent); font-size: 11px; background: color-mix(in srgb, currentColor 3%, transparent); }
.ad-finding[data-level="error"] { border-color: color-mix(in srgb, #e5484d 40%, transparent); }
.ad-finding .ad-rule { font-family: ui-monospace, monospace; color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); font-size: 10px; }
.ad-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e5e5); margin-bottom: 12px; }
.ad-tabs button { padding: 6px 10px; border: 0; background: transparent; cursor: pointer; border-bottom: 2px solid transparent; }
.ad-tabs button[data-active="true"] { border-bottom-color: #3b6ef6; font-weight: 600; }
.ad-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.42); display: grid; place-items: center; z-index: 80; padding: 20px; }
.ad-modal { width: min(640px, 100%); max-height: 86vh; overflow: auto; background: var(--dsw-alias-bg-overlay, #fff);
  border: 1px solid var(--dsw-alias-border-l1, #ddd); border-radius: 14px; padding: 18px; box-shadow: 0 24px 70px rgba(0,0,0,.28); }
.ad-modal h2 { margin: 0 0 12px; font-size: 16px; }
.ad-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.ad-toast { position: sticky; bottom: 0; margin: 10px 18px; padding: 9px 13px; border-radius: 9px;
  background: var(--dsw-alias-bg-overlay, #1f1f1f); border: 1px solid color-mix(in srgb, currentColor 22%, transparent); font-size: 12px; }
.ad-toast[data-kind="error"] { border-color: #e5484d; color: #ff8a8f; }
.ad-toast[data-kind="ok"] { border-color: #18a058; color: #6ee7a8; }
.ad-empty { padding: 60px 20px; text-align: center; }
.ad-empty h2 { margin: 0 0 8px; }
.ad-empty p { max-width: 460px; margin: 0 auto 16px; color: var(--dsw-alias-label-secondary, #777); }
.ad-kv { display: grid; grid-template-columns: 92px 1fr; gap: 4px 8px; font-size: 11px; }
.ad-kv b { color: var(--dsw-alias-label-secondary, #777); font-weight: 500; }
.ad-split { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 14px; }
.ad-list { display: flex; flex-direction: column; gap: 4px; }
.ad-list button { text-align: left; padding: 8px 10px; border-radius: 9px; border: 1px solid transparent; background: transparent; cursor: pointer; }
.ad-list button:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
.ad-list button[data-active="true"] { border-color: color-mix(in srgb, currentColor 22%, transparent); background: color-mix(in srgb, currentColor 9%, transparent); }
.ad-progress { height: 3px; border-radius: 999px; background: color-mix(in srgb, currentColor 14%, transparent); overflow: hidden; }
.ad-progress > i { display: block; height: 100%; background: #3b6ef6; border-radius: 999px; transition: width .4s; }
.ad-note { font-size: 11px; color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)); border-left: 2px solid color-mix(in srgb, currentColor 22%, transparent); padding-left: 8px; }
@media (max-width: 1180px) {
  .ad-body { grid-template-columns: 168px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .ad-side {
    display: block; grid-column: 1 / -1; grid-row: 2;
    max-height: 46vh; border-left: 0;
    border-top: 1px solid color-mix(in srgb, currentColor 17%, transparent);
  }
}
@media (max-width: 760px) {
  .ad-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; }
  .ad-rail { display: flex; gap: 4px; overflow-x: auto; border-right: 0; border-bottom: 1px solid color-mix(in srgb, currentColor 17%, transparent); }
  .ad-rail button { width: auto; flex: none; }
  .ad-rail .ad-rail-hint, .ad-rail .ad-rail-meta { display: none; }
  .ad-grid3, .ad-grid2 { grid-template-columns: 1fr; }
  .ad-split { grid-template-columns: 1fr; }
  .ad-side { grid-row: 3; max-height: 52vh; }
}
`
}
