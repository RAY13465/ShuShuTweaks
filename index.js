/**
 * 鼠鼠面板工坊 ShuShu Panel —— v0.3
 * ---------------------------------------------------------------------------
 * 把酒馆「角色管理面板」做成可装配的模块：
 *   按钮(原子) → 模块(容器，可 1~2 层，每层放任意按钮) → 分区(头部/列表/底部栏)
 *   桌面 / 手机两套独立布局；装配界面内化在面板里（细条入口 + 方框）
 *   一键「恢复原版」把一切精确还原回酒馆原样
 *
 * 三条安全底线：
 *   1. 零 import —— 依赖全从 SillyTavern.getContext() 拿
 *   2. 搬 DOM 之前先拍「父容器 children 快照」，还原时按快照顺序 append 回去
 *   3. reclaim() 只做「让活着的元素回到该在的位置」，幂等、对重建免疫、找不到就跳过
 *
 * ⚠️ MODULE_NAME 一旦发布永远不许改。
 */

const MODULE_NAME = 'shushu_panel';
const LOG = '[ShuShuPanel]';
const SCHEMA_VERSION = 4;
const MOUNT_ID = 'ssp_mount';
const BOX_ID = 'ssp_box';
const TOGGLE_ID = 'ssp_toggle';
const ZONE_PREFIX = 'ssp_zone_';
/** 模块内容的对齐方式：左 / 中 / 右（就是 flex 的 justify-content） */
const ALIGNS = ['left', 'center', 'right'];
const ALIGN_CSS = { left: 'flex-start', center: 'center', right: 'flex-end' };

/* ==========================================================================
   按钮表 —— native 全是 public/index.html 里的真实选择器
   rebuilt: 酒馆会重画它（每次都得重新认领）
   ========================================================================== */
const BUTTONS = [
    { id: 'pin',      name: '面板钉住',   icon: 'fa-lock',              form: 'icon',   native: '#rm_button_panel_pin_div' },
    { id: 'listbtn',  name: '角色列表',   icon: 'fa-list-ul',           form: 'icon',   native: '#rm_button_characters' },
    { id: 'hotswap',  name: '收藏头像',   icon: 'fa-star',              form: 'icons',  native: '#HotSwapWrapper' },
    { id: 'create',   name: '新建角色',   icon: 'fa-user-plus',         form: 'icon',   native: '#rm_button_create' },
    { id: 'import',   name: '文件导入',   icon: 'fa-file-import',       form: 'icon',   native: '#character_import_button' },
    { id: 'url',      name: 'URL 导入',   icon: 'fa-cloud-arrow-down',  form: 'icon',   native: '#external_import_button' },
    { id: 'group',    name: '新建群聊',   icon: 'fa-users-gear',        form: 'icon',   native: '#rm_button_group_chats' },
    { id: 'extbtn',   name: '其他扩展按钮', icon: 'fa-plug',            form: 'icons',  native: '#rm_buttons_container', note: '别的扩展往这里加按钮' },
    { id: 'sort',     name: '排序',       icon: 'fa-arrow-down-wide-short', form: 'select', native: '#character_sort_order' },
    { id: 'searchbar',name: '搜索框',     icon: 'fa-magnifying-glass',  form: 'wide',   native: '#character_search_bar' },
    { id: 'searchbtn',name: '搜索开关',   icon: 'fa-magnifying-glass',  form: 'icon',   native: '#rm_button_search' },
    // ⚠️ index.html 里有 3 个 .rm_tag_controls（另外两个在群聊面板里，而且
    //    `CHARACTER_FILTER_SELECTOR = '#rm_characters_block .rm_tag_filter'` 会把它们
    //    也一起填满标签 —— 用裸 `.rm_tag_controls` 会搬错那个，真身反而留在原地，
    //    结果面板上出现两排一模一样的标签。只有 #charListFixedTop 里这个才是真身。
    { id: 'tags',     name: '标签筛选',   icon: 'fa-tags',              form: 'icons',  native: '#charListFixedTop .rm_tag_controls', rebuilt: true, note: '酒馆每次都会重建里面的标签' },
    { id: 'pager',    name: '分页',       icon: 'fa-table-list',        form: 'wide',   native: '#rm_print_characters_pagination .paginationjs', rebuilt: true },
    { id: 'grid',     name: '网格切换',   icon: 'fa-table-cells-large', form: 'icon',   native: '#charListGridToggle' },
    { id: 'bulk',     name: '批量编辑',   icon: 'fa-edit',              form: 'icon',   native: '#bulkEditButton', note: '含全选/删除/计数' },
    // B 组「纯新增」按钮：酒馆原生面板里没有，我们自己造 + 自己接行为。
    //   made: true → 已实装（ensureNewBtnEls 会造出元素）
    //   没 made 的只留在装配界面里当预告，不会占面板的位置
    { id: 'recent',   name: '最近聊天',   icon: 'fa-clock',             form: 'icon',   native: null, isNew: true, made: true, hint: '按「最近聊天」排序' },
    { id: 'favs',     name: '收藏夹',     icon: 'fa-bookmark',          form: 'icon',   native: null, isNew: true, made: true, hint: '只看收藏（再点一次取消）' },
    { id: 'random',   name: '随机抽卡',   icon: 'fa-dice',              form: 'icon',   native: null, isNew: true, made: true, hint: '随机抽一张卡直接开聊' },
    { id: 'stats',    name: '库统计',     icon: 'fa-chart-simple',      form: 'icon',   native: null, isNew: true, made: true, hint: '看看角色库的库存' },
    { id: 'reorder',  name: '手动排序',   icon: 'fa-arrows-up-down-left-right', form: 'icon', native: null, isNew: true, made: true, hint: '拖拽角色卡调整顺序（顺序会记住）' },
];

/* 分区：
   head 插在 #charListFixedTop 最前（按钮条那一堆）
   foot 插在 #right-nav-panel 的滚动容器最后 —— 挂在这里 + sticky 才是真正的「底部栏」，
        挂在 #rm_characters_block 里只会跟着列表滚走（那个不是滚动容器）。
   ⚠️ `.scrollableInner` 全页有好几个，必须带上 #right-nav-panel 限定，否则会挂到左边栏去。 */
const ZONES = [
    { id: 'head', name: '头部', desc: '面板头部 + 按钮条 + 搜索 + 筛选', anchor: '#charListFixedTop', where: 'prepend' },
    { id: 'foot', name: '底部栏', desc: '钉在面板底部（列表下方）', anchor: '#right-nav-panel .scrollableInner', where: 'append' },
];
const ZONE_IDS = ZONES.map(z => z.id);
/** 锁定的「列表」── 不可移动不可隐藏，只作为分区展示 */
const LIST_ZONE = { id: 'list', name: '列表', desc: '角色列表本体（内容，不可移动）', locked: true };

/* ==========================================================================
   默认布局（两套）
   ========================================================================== */
function defaultLayout(dev) {
    const mods = [
        { id: 'p1', name: '面板头部',   on: true,  rows: [['pin', 'listbtn', 'hotswap']] },
        { id: 'p2', name: '新建与导入', on: true,  rows: [['create', 'import', 'url', 'group', 'extbtn']] },
        { id: 'p3', name: '排序与搜索', on: true,  rows: [['sort', 'searchbtn'], ['searchbar']] },
        { id: 'p4', name: '标签筛选',   on: true,  rows: [['tags']] },
        { id: 'p5', name: '工具与分页', on: true,  rows: [['pager', 'grid', 'bulk']] },
        { id: 'p6', name: '底部快捷',   on: true,  align: 'center', rows: [['recent', 'favs', 'random', 'stats', 'reorder']] },
    ];
    if (dev === 'mobile') {
        // 手机屏窄：默认少放几个，顺序也不同
        const off = new Set(['p1', 'p4', 'p5']);
        mods.forEach(m => { if (off.has(m.id)) m.on = false; });
        return { modules: mods, zones: { head: ['p2', 'p3', 'p1', 'p4', 'p5'], foot: ['p6'] } };
    }
    return { modules: mods, zones: { head: ['p1', 'p2', 'p3', 'p4', 'p5'], foot: ['p6'] } };
}

/* ==========================================================================
   基础
   ========================================================================== */
function log(...a) { console.log(LOG, ...a); }
function warn(...a) { console.warn(LOG, ...a); }

function queryAll(sel) {
    try { return Array.from(document.querySelectorAll(sel)); }
    catch (e) { warn('选择器无效：', sel, e); return []; }
}
function query(sel) { return queryAll(sel)[0] || null; }

function getContext() {
    const c = globalThis.SillyTavern?.getContext?.();
    return (c && typeof c === 'object') ? c : null;
}
function isMobileDevice() {
    try { return Boolean(getContext()?.isMobile?.()); } catch { return false; }
}
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* 属性读写（统一用 get/setAttribute，拿到的才是原始文本而不是浏览器补全后的绝对地址） */
function attrOf(el, key) {
    if (!el) return '';
    if (typeof el.getAttribute === 'function') return el.getAttribute(key);
    return el[key] == null ? '' : String(el[key]);
}
function setAttr(el, key, val) {
    if (!el) return;
    if (typeof el.setAttribute === 'function') el.setAttribute(key, val);
    else el[key] = val;
}

/* ==========================================================================
   B 组「纯新增」按钮：酒馆里没有，我们自己做 + 自己接行为
   --------------------------------------------------------------------------
   行为一律走酒馆自己的入口，绝不重写一遍逻辑：
     最近聊天 → 让它自己去排序下拉框里选「Recent」
     收藏夹   → 点它自己那个「只看收藏」圆形筛选钮
     随机抽卡 → 调它自己的 selectCharacterById 开聊
     库统计   → 用 getCharacters() 的数算一下
   这样酒馆改了实现、加了联动，我们跟着一起变，不会暗中跑偏。
   ========================================================================== */
const newEls = new Map();          // 纯新增按钮 id → 我们造的 element

/** 让酒馆自己按某个字段排序（效果 = 用户去下拉框里手动选一下） */
function sortByField(field) {
    const sel = query('#character_sort_order');
    if (!sel) return false;
    const opts = Array.from(sel.options || []);
    const opt = opts.find(o => (o.dataset && o.dataset.field || (o.getAttribute && o.getAttribute('data-field'))) === field);
    if (!opt) return false;
    sel.value = opt.value;
    opt.selected = true;
    // 酒馆的 handler 挂在原生 change 事件上（power-user.js），派发它就等于用户选了一次
    if (typeof Event === 'function' && sel.dispatchEvent) sel.dispatchEvent(new Event('change', { bubbles: true }));
    else if (globalThis.jQuery) globalThis.jQuery(sel).trigger('change');
    else return false;
    return true;
}

/** 点一下酒馆自己的圆形筛选钮（收藏 / 群组 / 文件夹都是这么切的） */
function clickTagAction(cls) {
    const chip = query('#charListFixedTop .rm_tag_filter .' + cls) || query('.' + cls);
    if (!chip) return null;
    if (chip.click) chip.click();
    else if (typeof Event === 'function' && chip.dispatchEvent) chip.dispatchEvent(new Event('click', { bubbles: true }));
    else return null;
    return chip;
}
function hasClass(el, cls) {
    if (!el) return false;
    if (el.classList && typeof el.classList.contains === 'function') return el.classList.contains(cls);
    return new RegExp('(^|\\s)' + cls + '(\\s|$)').test(String(el.className || ''));
}

/** 随机抽一张卡直接开聊 */
function pickRandomCharacter() {
    const ctx = getContext();
    const chars = (ctx && typeof ctx.getCharacters === 'function' ? ctx.getCharacters() : null) || [];
    const pool = chars.filter(c => c && c.avatar);
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (typeof ctx.selectCharacterById === 'function') ctx.selectCharacterById(pick.avatar);
    return pick;
}

/** 库统计：总数 / 收藏 / 标签数 */
function libraryStats() {
    const ctx = getContext();
    const chars = (ctx && typeof ctx.getCharacters === 'function' ? ctx.getCharacters() : null) || [];
    const tagSet = new Set();
    let favs = 0;
    chars.forEach(c => {
        if (c && c.fav) favs += 1;
        ((c && c.tags) || []).forEach(t => tagSet.add(t));
    });
    return { total: chars.length, favs, tags: tagSet.size };
}
function showLibraryStats() {
    const st = libraryStats();
    const ctx = getContext();
    const html = `<div class="ssp-stats"><b>${st.total}</b> 个角色 · <b>${st.favs}</b> 个收藏 · <b>${st.tags}</b> 个标签</div>`;
    if (ctx && typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) {
        try { ctx.callGenericPopup(html, ctx.POPUP_TYPE.TEXT); return true; } catch (e) { warn('弹窗失败，改用通知', e); }
    }
    toast(`角色库：${st.total} 个角色 · ${st.favs} 个收藏 · ${st.tags} 个标签`, 'info');
    return true;
}

const ACTIONS = {
    recent: () => { if (!sortByField('date_last_chat')) toast('没找到排序下拉框', 'warning'); else toast('已按「最近聊天」排序', 'info'); },
    favs: () => {
        const chip = clickTagAction('filterByFavorites');
        if (!chip) { toast('没找到「只看收藏」筛选钮', 'warning'); return; }
        toast(hasClass(chip, 'selected') ? '只看收藏' : '取消收藏筛选', 'info');
    },
    random: () => { const p = pickRandomCharacter(); if (!p) toast('角色库是空的', 'warning'); else toast(`抽到了「${p.name || p.avatar}」`, 'success'); },
    stats: () => showLibraryStats(),
    reorder: () => { setSortMode(!sortMode); },
};

/** 给已实装的纯新增按钮造元素（幂等） */
function ensureNewBtnEls() {
    BUTTONS.forEach(b => {
        if (b.native || !b.made || newEls.has(b.id)) return;
        const el = document.createElement('div');
        el.id = 'ssp_btn_' + b.id;
        el.className = 'menu_button fa-solid ' + b.icon + ' ssp-newbtn';
        el.title = b.name + (b.hint ? '：' + b.hint : '');
        if (el.setAttribute) el.setAttribute('data-ssp-made', b.id);
        el.addEventListener('click', ev => {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            try { if (ACTIONS[b.id]) ACTIONS[b.id](); } catch (e) { warn('新增按钮执行出错：', b.id, e); }
        });
        newEls.set(b.id, el);
    });
}

/* ==== 生成区：角色卡样式数据（来源：角色卡美化-原型.html，别手改） 开始 ==== */
/* ==========================================================================
   鼠鼠面板工坊 · 角色卡样式数据
   --------------------------------------------------------------------------
   这个文件是自动生成的（来源：角色卡美化-原型.html），别手改 ——
   要改样式就改原型、重新生成。

   CARD_STYLES：8 段样式本体（参数写成 var(--pv-*, 默认值)，由旋钮覆盖）
   CARD_OPT   ：可拼装的选项片段，扩展按抽屉里的旋钮挑着拼
   ========================================================================== */

const CARD_STYLES = {
    /* 封面渐隐 —— 铺满整行 */
    cover: { name: '封面渐隐', hint: '铺满整行', css: `
/* 头像铺满整行当封面，图片向下化进底色；名字/简介压在渐隐区上 */
#rm_print_characters_block .character_select{
  display:block; position:relative; padding:0; margin:0 0 var(--pv-gap,6px);
  height:var(--pv-h,104px); border-radius:var(--pv-radius,12px); overflow:hidden;
}
#rm_print_characters_block .character_select:hover{ background:transparent; }
#rm_print_characters_block .character_select .avatar{ position:absolute; inset:0; width:100%; height:100%; flex:none; border-radius:0; align-self:auto; }
#rm_print_characters_block .character_select .avatar img{ width:100%; height:100%; object-fit:cover; border:0; border-radius:0; box-shadow:none;
  transition:transform .5s ease, filter .35s ease; }
#rm_print_characters_block .character_select .character_select_container{
  position:relative; z-index:2; width:auto; height:100%; padding:var(--pv-pad,10px 12px);
  display:flex; flex-direction:column; justify-content:flex-end; gap:2px;
}
#rm_print_characters_block .character_select .character_name_block{ margin:0; }
#rm_print_characters_block .character_select .ch_name{ font-size:var(--pv-name,15.5px); text-shadow:0 1px 8px rgba(0,0,0,.9); }
#rm_print_characters_block .character_select .ch_description{ margin:0; opacity:.86; line-height:1.4; }
#rm_print_characters_block .character_select.is_fav::before{
  content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--golden); z-index:3;
}
#rm_print_characters_block .character_select.is_fav .avatar{ outline:none; }
    ` },

    /* 侧图渐隐 —— 杂志感 */
    side: { name: '侧图渐隐', hint: '杂志感', css: `
/* 左侧一块大图，右边缘化进底色，右边放文字 */
#rm_print_characters_block .character_select{
  position:relative; display:flex; align-items:center; padding:0; overflow:hidden;
  margin:0 0 var(--pv-gap,8px); height:var(--pv-h,92px); border-radius:var(--pv-radius,14px);
}
#rm_print_characters_block .character_select:hover{ background:transparent; }
#rm_print_characters_block .character_select .avatar{ position:absolute; left:0; top:0; bottom:0; width:min(42%, calc(var(--pv-h,92px) * 1.05)); height:100%; flex:none; border-radius:0; align-self:auto; }
#rm_print_characters_block .character_select .avatar img{ width:100%; height:100%; object-fit:cover; border:0; border-radius:0; box-shadow:none; }
#rm_print_characters_block .character_select .character_select_container{ margin-left:42%; width:auto; padding:10px 12px; gap:3px; z-index:2; }
#rm_print_characters_block .character_select .character_name_block{ margin:0; }
#rm_print_characters_block .character_select .ch_name{ font-size:var(--pv-name,15px); }
#rm_print_characters_block .character_select .ch_description{ margin:0; }
#rm_print_characters_block .character_select .tags_inline{ margin-top:4px; }
#rm_print_characters_block .character_select.is_fav .avatar{ outline:none; }
#rm_print_characters_block .character_select.is_fav::after{
  content:"★"; position:absolute; left:6px; top:6px; z-index:3; color:var(--golden);
  text-shadow:0 1px 4px rgba(0,0,0,.9); font-size:12px;
}
    ` },

    /* 双列封面 —— 像作品集 */
    grid: { name: '双列封面', hint: '像作品集', css: `
/* 两列网格，图片当封面 —— 相当于把酒馆自带的网格模式做精致 */
#rm_print_characters_block { display:grid; grid-template-columns:1fr 1fr; gap:var(--pv-gap,8px); align-content:start; }
#rm_print_characters_block .character_select{
  display:block; position:relative; padding:0; margin:0; overflow:hidden;
  height:var(--pv-h,200px); border-radius:var(--pv-radius,12px);
}
#rm_print_characters_block .character_select:hover{ background:transparent; }
#rm_print_characters_block .character_select .avatar{ position:absolute; inset:0; width:100%; height:100%; border-radius:0; align-self:auto; }
#rm_print_characters_block .character_select .avatar img{ width:100%; height:100%; object-fit:cover; border:0; border-radius:0; box-shadow:none; }
#rm_print_characters_block .character_select .avatar::after{ content:""; position:absolute; inset:0;
  background:linear-gradient(to top, rgba(0,0,0,.82) 4%, rgba(0,0,0,.25) 38%, transparent 62%); }
#rm_print_characters_block .character_select .character_select_container{
  position:absolute; left:0; right:0; bottom:0; z-index:2; width:auto; padding:8px 9px;
  display:flex; flex-direction:column; gap:1px;
}
#rm_print_characters_block .character_select .character_name_block{ margin:0; }
#rm_print_characters_block .character_select .ch_name{ font-size:var(--pv-name,13.5px); color:#fff; text-shadow:0 1px 6px rgba(0,0,0,.85); }
#rm_print_characters_block .character_select .ch_description{ display:none; }
#rm_print_characters_block .character_select .tags_inline{ margin-top:3px; }
#rm_print_characters_block .character_select .tags_inline .tag{ font-size:9.5px; border-color:rgba(255,255,255,.4); color:#fff; }
#rm_print_characters_block .character_select.is_fav .ch_name{ color:var(--golden); }
#rm_print_characters_block .character_select.is_fav::before{ content:"★"; position:absolute; right:7px; top:5px; z-index:3;
  color:var(--golden); font-size:13px; text-shadow:0 1px 4px rgba(0,0,0,.9); }
    ` },

    /* 单行紧凑 —— 一屏看很多 */
    compact: { name: '单行紧凑', hint: '一屏看很多', css: `
/* 小而密的单行：小圆头像 + 名字 + 简介跟在后面 + 标签靠右 */
#rm_print_characters_block .character_select{ display:flex; align-items:center; gap:8px; padding:3px 6px; margin-bottom:var(--pv-gap,2px);
  border-radius:var(--pv-radius,8px); flex-wrap:nowrap; }
#rm_print_characters_block .character_select .avatar{ width:calc(var(--pv-h,104px) * 0.25); height:calc(var(--pv-h,104px) * 0.25); flex:none; }
#rm_print_characters_block .character_select .avatar img{ width:100%; height:100%; box-shadow:none; }
#rm_print_characters_block .character_select .character_select_container{ flex-direction:row; align-items:center; gap:8px;
  width:auto; flex:1 1 auto; min-width:0; }
#rm_print_characters_block .character_select .character_name_block{ margin:0; flex:0 1 auto; min-width:0; }
#rm_print_characters_block .character_select .ch_name{ flex:0 1 auto; font-size:var(--pv-name,13px); }
#rm_print_characters_block .character_select .ch_additional_info{ font-size:10px; }
#rm_print_characters_block .character_select .ch_description{ margin:0; flex:1 1 auto; width:auto; min-width:0; opacity:.55; font-size:11.5px; }
#rm_print_characters_block .character_select .tags_inline{ margin:0; flex:none; }
#rm_print_characters_block .character_select.is_fav .avatar{ outline-width:1.5px; }
    ` },

    /* 悬停展开 —— 平时低调，指上去出图 */
    reveal: { name: '悬停展开', hint: '平时低调，指上去出图', css: `
/* 默认是一条暗图行，鼠标指上去卡片长高、图片亮起、简介和标签浮现 */
#rm_print_characters_block .character_select{ position:relative; display:flex; align-items:flex-end; padding:0; overflow:hidden;
  height:54px; margin-bottom:var(--pv-gap,5px); border-radius:var(--pv-radius,12px);
  transition:height .34s cubic-bezier(.22,.61,.36,1); }
#rm_print_characters_block .character_select:hover{ background:transparent; height:var(--pv-h,124px); }
#rm_print_characters_block .character_select .avatar{ position:absolute; inset:0; width:100%; height:100%; flex:none; border-radius:0; align-self:auto; }
#rm_print_characters_block .character_select .avatar img{ width:100%; height:100%; object-fit:cover; border:0; border-radius:0; box-shadow:none;
  opacity:.42; transition:opacity .3s ease, transform .5s ease; }
#rm_print_characters_block .character_select:hover .avatar img{ opacity:1; transform:scale(1.03); }
#rm_print_characters_block .character_select .character_select_container{ position:relative; z-index:2; width:100%; padding:8px 12px; gap:2px; }
#rm_print_characters_block .character_select .character_name_block{ margin:0; }
#rm_print_characters_block .character_select .ch_name{ font-size:var(--pv-name,15.5px); }
#rm_print_characters_block .character_select .ch_description{ margin:0; max-height:0; opacity:0; transition:max-height .3s ease, opacity .3s ease; }
#rm_print_characters_block .character_select:hover .ch_description{ max-height:32px; opacity:.85; }
#rm_print_characters_block .character_select .tags_inline{ margin-top:3px; opacity:0; transition:opacity .3s ease .05s; }
#rm_print_characters_block .character_select:hover .tags_inline{ opacity:1; }
#rm_print_characters_block .character_select.is_fav::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
  background:var(--golden); z-index:3; }
#rm_print_characters_block .character_select.is_fav .avatar{ outline:none; }
    ` },

    /* 叠层相册 —— 上压下 + 上实下虚，悬停全实 */
    stack: { name: '叠层相册', hint: '上压下 + 上实下虚，悬停全实', css: `
/* 叠层相册：
   静止 = 上面一张压着下面一张（叠压程度那个旋钮管压多少），每张卡**上实下虚** ——
          图片从顶部的实，一路淡到"下一张压上来"的那条线上正好化没，
          所以看着是一张张摞着、底边融进下面那张里。
   悬停 = 整张完整浮出来（抬到最上层），遮罩整个取消 → **全实**。
   淡出位置跟着「叠压程度」自动走，不用另设旋钮。 */
#rm_print_characters_block { padding-top:10px; }
/* 露出来的那一截 = 100% − 叠压程度。--pv-vis 放在卡片上，图片渐隐和整体裁剪共用同一个值。
   ⚠️ 光给 .avatar 做渐隐不够：**标签是文字层，不受那个 mask 管**，
      于是下面那张卡被压住的标签照样透出来。所以整张卡再按同一条线 clip 一刀。 */
#rm_print_characters_block .character_select{ position:relative; height:var(--pv-h,78px); padding:0; overflow:visible;
  --pv-vis:calc(100% - var(--pv-overlay,20) * 1%);
  clip-path:inset(0 0 calc(100% - var(--pv-vis)) 0);
  margin-top:calc(var(--pv-gap,6px) - 6px - var(--pv-h,78px) * var(--pv-overlay,20) / 100); border-radius:var(--pv-radius,14px);
  transition:transform .25s ease, margin .25s ease, clip-path .2s ease; }
#rm_print_characters_block .character_select:first-child{ margin-top:0; }
#rm_print_characters_block .character_select:hover{ background:transparent; transform:translateX(8px); z-index:9; clip-path:none; }
/* 图片：上实下虚，淡出正好收在裁剪线上 */
#rm_print_characters_block .character_select .avatar{ position:absolute; inset:0; width:100%; height:100%; border-radius:inherit;
  overflow:hidden; align-self:auto;
  -webkit-mask-image:linear-gradient(to bottom, #000 0, #000 calc(var(--pv-vis) - 30%), transparent var(--pv-vis));
  mask-image:linear-gradient(to bottom, #000 0, #000 calc(var(--pv-vis) - 30%), transparent var(--pv-vis));
  box-shadow:0 -5px 12px rgba(0,0,0,.3), 0 0 0 1px var(--SmartThemeBorderColor, rgba(255,255,255,.12));
  transition:box-shadow .25s ease; }
#rm_print_characters_block .character_select:hover .avatar{ -webkit-mask-image:none; mask-image:none;
  box-shadow:0 12px 28px rgba(0,0,0,.55), 0 0 0 1px var(--SmartThemeBorderColor, rgba(255,255,255,.18)); }
#rm_print_characters_block .character_select .avatar img{ width:100%; height:100%; object-fit:cover; border:0; border-radius:0; box-shadow:none; }
/* 文字不再压遮罩（图片自己会淡出），靠阴影吃住任何底色 —— 所以不悬停也读得清 */
#rm_print_characters_block .character_select .character_select_container{ position:absolute; inset:0; z-index:2; width:auto; padding:10px 14px;
  justify-content:center; gap:2px; border-radius:inherit; background:transparent; }
#rm_print_characters_block .character_select .character_name_block{ margin:0; }
#rm_print_characters_block .character_select .ch_name{ font-size:var(--pv-name,15.5px); color:#fff;
  text-shadow:0 1px 4px rgba(0,0,0,.9), 0 0 12px rgba(0,0,0,.6); }
#rm_print_characters_block .character_select .ch_description{ margin:0; color:rgba(255,255,255,.8); text-shadow:0 1px 4px rgba(0,0,0,.8); }
#rm_print_characters_block .character_select.is_fav .ch_name{ color:var(--golden); }
#rm_print_characters_block .character_select.is_fav .avatar{ box-shadow:0 -5px 12px rgba(0,0,0,.3), 0 0 0 2px var(--golden); }
#rm_print_characters_block .character_select.is_fav:hover .avatar{ box-shadow:0 12px 28px rgba(0,0,0,.55), 0 0 0 2px var(--golden); }
    ` },

    /* 歌单行 —— 网易云那种一行一首 */
    halo: { name: '歌单行', hint: '网易云那种一行一首', css: `
/* 网易云那种歌单行：序号 + 方块封面（左下角小角标）+ 名字 / 标签·简介 + ★收藏 + 右侧版本号
   整个列表铺一层渐变、行悬停提亮、行间一条细线 —— 和真歌单一样。
   · 底色可以自定义：抽屉里的「歌单底色」写进 --pv-songbg（没给就用默认紫）
   · 封面、序号、字号全都跟着「卡片高度」自适应（有下限、也有上限防呆）
   · ★ 是能点的：点了收藏 / 取消收藏这张卡（走 /api/characters/merge-attributes）
   面板只有 ~350px 宽，所以歌单里那列"专辑名"并进了第二行（跟标签一起）；
   面板拉宽后想要真·中间列，把 .ch_description 改成绝对定位即可。 */
#rm_print_characters_block { counter-reset:stu; padding:4px 0; border-radius:var(--pv-radius,6px);
  background:linear-gradient(168deg, var(--pv-songbg,#4a2b7d) 0%, #241a49 44%, #0e0a22 100%);
  background:linear-gradient(168deg, var(--pv-songbg,#4a2b7d) 0%,
    color-mix(in srgb, var(--pv-songbg,#4a2b7d) 45%, #0e0a22) 46%, #0e0a22 100%); }
#rm_print_characters_block .character_select{
  counter-increment:stu; position:relative; display:flex; flex-wrap:wrap; align-items:center;
  box-sizing:border-box; height:var(--pv-h,56px); min-height:46px;
  column-gap:clamp(10px, calc(var(--pv-h,56px) * 0.12), 16px); row-gap:1px;
  /* 右边留出 ★ + 版本号 的位置（跟着高度一起放大，但有上限，别把正文挤没了） */
  --pv-res:clamp(84px, calc(var(--pv-h,56px) * 1.35), 128px);
  margin:0 0 var(--pv-gap,0px); padding:0 var(--pv-res) 0 0;
  border:0; border-radius:var(--pv-radius,6px); background:transparent; overflow:hidden;
  transition:background .16s ease; }
#rm_print_characters_block .character_select:hover{ background:rgba(255,255,255,.07); }
/* ① 序号 */
#rm_print_characters_block .character_select::before{
  content:counter(stu, decimal-leading-zero); order:0; flex:0 0 auto;
  width:clamp(32px, calc(var(--pv-h,56px) * 0.62), 54px); text-align:center;
  font-size:clamp(12px, calc(var(--pv-h,56px) * 0.21), 17px);
  font-variant-numeric:tabular-nums; color:rgba(255,255,255,.34); }
/* ② 封面（方块圆角，左下角一个小角标 = 歌单里的「超清母带」）—— 跟着高度自适应变大 */
#rm_print_characters_block .character_select .avatar{
  order:1; position:relative; flex:0 0 auto; align-self:center; z-index:2;
  width:calc(var(--pv-h,56px) * 0.72); height:calc(var(--pv-h,56px) * 0.72);
  min-width:34px; min-height:34px; max-width:64%; max-height:82%;
  border-radius:max(4px, calc(var(--pv-h,56px) * 0.09)); overflow:hidden;
  box-shadow:0 2px 8px rgba(0,0,0,.35); }
#rm_print_characters_block .character_select .avatar img{ width:100%; height:100%; object-fit:cover; object-position:center var(--pv-focus,32%);
  border:0; box-shadow:none; }
#rm_print_characters_block .character_select .avatar::after{
  content:"HD"; position:absolute; left:0; bottom:0;
  padding:0 max(3px, calc(var(--pv-h,56px) * 0.05)); line-height:max(12px, calc(var(--pv-h,56px) * 0.2));
  border-radius:0 max(4px, calc(var(--pv-h,56px) * 0.08)) 0 0;
  background:linear-gradient(90deg,#ff4d6d,#ff7a59);
  color:#fff; font-size:max(8px, calc(var(--pv-h,56px) * 0.13)); font-weight:700; letter-spacing:.2px; }
/* ③ 名字独占第一行；标签 + 简介首行在第二行 */
#rm_print_characters_block .character_select .character_select_container{
  order:2; position:static; flex:1 1 auto; min-width:0; width:auto; max-width:none; max-height:100%;
  display:flex; flex-direction:row; flex-wrap:wrap; align-items:center; align-content:center;
  column-gap:6px; row-gap:1px; margin:0; padding:0; overflow:visible; border:0; }
#rm_print_characters_block .character_select .character_name_block{ order:0; position:static; flex:1 1 100%; margin:0; display:block; }
#rm_print_characters_block .character_select .ch_name{
  display:block; width:100%; font-size:var(--pv-name,15.5px); font-weight:500; letter-spacing:0;
  color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#rm_print_characters_block .character_select .tags_inline{
  order:1; position:static; flex:0 1 auto; min-width:0; margin:0; display:flex; align-items:center;
  gap:0; font-size:clamp(11px, calc(var(--pv-h,56px) * 0.17), 14px); color:rgba(255,255,255,.55);
  white-space:nowrap; overflow:hidden; }
#rm_print_characters_block .character_select .tags_inline .tag{ font-size:inherit; padding:0; border:0; background:none; color:inherit; }
#rm_print_characters_block .character_select .tags_inline .tag::after{ content:"·"; margin:0 5px; opacity:.55; }
#rm_print_characters_block .character_select .tags_inline .tag:last-child::after{ content:""; margin:0; }
#rm_print_characters_block .character_select .ch_description{ order:2; flex:1 1 auto; min-width:0; margin:0; padding:0; font-size:0; }
#rm_print_characters_block .character_select .ch_description::before{
  content:var(--ssp-line,""); display:block;
  font-size:clamp(11px, calc(var(--pv-h,56px) * 0.18), 15px); color:rgba(255,255,255,.42);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* ④ ★ 收藏 —— 这个能点：灰星=没收藏，金星=收藏了 */
#rm_print_characters_block .character_select .ch_fav_icon{
  order:3; display:flex !important; position:absolute;
  right:calc(var(--pv-res) - clamp(22px, calc(var(--pv-h,56px) * 0.4), 40px));
  top:0; bottom:0; z-index:3; align-items:center; margin:0; padding:0;
  font-size:clamp(13px, calc(var(--pv-h,56px) * 0.24), 20px); cursor:pointer; }
#rm_print_characters_block .character_select .ch_fav_icon::before{
  content:"\\f005"; font-family:"Font Awesome 6 Free","Font Awesome 5 Free",sans-serif; font-weight:900;
  color:rgba(255,255,255,.3); transition:color .15s ease, transform .15s ease; }
#rm_print_characters_block .character_select .ch_fav_icon:hover::before{ color:rgba(255,255,255,.85); transform:scale(1.15); }
#rm_print_characters_block .character_select.is_fav .ch_fav_icon::before{ color:#ffd76a; }
/* ⑤ 最右边「时长」位 = 版本号（block + 右对齐 + 省略号，长了也不会压到 ★） */
#rm_print_characters_block .character_select .ch_additional_info{
  order:4; position:absolute; right:clamp(12px, calc(var(--pv-h,56px) * 0.2), 20px);
  top:50%; transform:translateY(-50%); z-index:2;
  display:block; width:clamp(44px, calc(var(--pv-h,56px) * 0.8), 76px); margin:0; padding:0;
  font-size:clamp(11px, calc(var(--pv-h,56px) * 0.18), 15px); font-variant-numeric:tabular-nums;
  color:rgba(255,255,255,.38);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right; }
/* 行间细线 + 收藏行名字变金 */
#rm_print_characters_block .character_select:not(:last-child)::after{
  content:""; position:absolute; left:clamp(46px, calc(var(--pv-h,56px) * 0.9), 84px); right:14px;
  bottom:0; height:1px; background:rgba(255,255,255,.07); }
#rm_print_characters_block .character_select.is_fav .ch_name{ color:#ffe3a3; }
    ` },

    /* 学生证 —— 扁平证件 */
    student: { name: '学生证', hint: '扁平证件', css: `
/* 学生证（扁平证件）
   顶部灰带：左「学生证 · 校名」 右「student ID + 列表序号」
   正文一行一个字段：姓名：角色卡名 / 班级：标签 / 学号：列表序号（CSS 计数器）
   右半边：淡淡的角色图影子（侧边渐隐，图片地址来自 --ssp-avatar）
   右下角：条形码（纯 CSS 条纹）
   尺寸按 --pv-h 算死；颜色走 --id-* 变量 */
#rm_print_characters_block { counter-reset: stu; }
#rm_print_characters_block .character_select{
  counter-increment: stu;
  position:relative; display:flex; flex-wrap:nowrap; align-items:center; gap:14px;
  box-sizing:border-box; height:var(--pv-h,210px); min-height:150px;
  --id-bandh:calc(var(--pv-h,210px) * 0.12);
  margin:0 0 var(--pv-gap,9px);
  padding:calc(var(--pv-h,210px) * 0.19) 14px calc(var(--pv-h,210px) * 0.155);
  border:0; border-radius:var(--pv-radius,4px); overflow:hidden;
  background:var(--id-paper,#f6f6f8);
  box-shadow:
    inset 0 var(--id-bandh,25px) 0 0 var(--id-band,#9a9aa1),
    inset 0 calc(-1 * var(--id-bandh,25px) * 0.8) 0 0 var(--id-band,#9a9aa1),
    0 6px 18px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.08);
  color:var(--id-ink,#3c3c42);
  transition:box-shadow .25s ease, transform .25s ease;
}
#rm_print_characters_block .character_select:hover{
  transform:translateY(-2px);
  box-shadow:
    inset 0 var(--id-bandh,25px) 0 0 var(--id-band,#9a9aa1),
    inset 0 calc(-1 * var(--id-bandh,25px) * 0.8) 0 0 var(--id-band,#9a9aa1),
    0 0 0 1px rgba(0,0,0,.08);
}
/* 顶部灰带左边：学生证 · 校名 */
#rm_print_characters_block .character_select::before{
  content:"学生证 · " var(--id-school,"温城大学");
  position:absolute; left:0; top:0; height:var(--id-bandh,25px); z-index:3;
  display:flex; align-items:center; padding:0 14px;
  font-size:13px; font-weight:800; letter-spacing:1.5px; color:#fff;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:58%;
}
/* 顶部灰带右边：student ID · 列表序号
   锚的是卡片（名字块已改成 static），top:0 = 卡片内边距盒顶 = 灰带顶，跟高度无关。 */
#rm_print_characters_block .character_select .ch_additional_info{
  order:9; position:absolute; right:14px; top:0; height:var(--id-bandh,25px); z-index:3;
  display:flex; align-items:center; margin:0; max-width:none; font-size:0; opacity:1;
}
#rm_print_characters_block .character_select .ch_additional_info::before{
  content:"student ID · No." counter(stu, decimal-leading-zero);
  font-family:"Arial Black","Helvetica Neue",Arial,sans-serif;
  font-size:12.5px; font-weight:800; letter-spacing:.4px; color:#fff;
}
/* 底部灰带右边：小字 */
#rm_print_characters_block .character_select::after{
  content:"仅限本人使用，不得转借";
  position:absolute; right:14px; bottom:0; height:calc(var(--id-bandh,25px) * 0.8); z-index:3;
  display:flex; align-items:center;
  font-size:9px; letter-spacing:.6px; color:rgba(255,255,255,.9);
}
/* 底部灰带左边：有效期 */
#rm_print_characters_block .character_select .avatar::after{
  content:"有效期 " var(--id-year,"2029") "-09";
  position:absolute; left:14px; bottom:0; height:calc(var(--id-bandh,25px) * 0.8); z-index:3;
  display:flex; align-items:center;
  font-size:9px; letter-spacing:.6px; color:rgba(255,255,255,.9);
}
/* 左侧证件照：白纸边 + 投影 */
#rm_print_characters_block .character_select .avatar{
  position:static; flex:0 0 auto; align-self:center; z-index:2;
  width:calc(var(--pv-h,210px) * 0.35); height:100%;
  max-height:calc(var(--pv-h,210px) * 0.60); min-width:52px; min-height:64px; max-width:40%;
  padding:4px; border-radius:2px; background:#fff; box-sizing:border-box; overflow:hidden;
  box-shadow:none;
  transform:none;
}
#rm_print_characters_block .character_select .avatar img{
  width:100%; height:100%; object-fit:cover; object-position:center var(--pv-focus,32%);
  border:0; border-radius:1px; box-shadow:none;
}
/* 右半边：淡淡的角色图影子，顺着左边缘渐隐（图片地址来自 --ssp-avatar） */
#rm_print_characters_block .character_select .character_select_container::after{
  content:""; position:absolute; right:0; top:var(--id-bandh,25px);
  bottom:calc(var(--id-bandh,25px) * 0.8);
  width:62%; z-index:0; pointer-events:none;
  background-image:var(--ssp-avatar,none); background-size:cover; background-position:center 20%;
  background-repeat:no-repeat;
  opacity:.16;
  -webkit-mask-image:linear-gradient(to left, #000 0 30%, transparent 94%);
  mask-image:linear-gradient(to left, #000 0 30%, transparent 94%);
}
/* 右下：条形码（纯 CSS 条纹） */
#rm_print_characters_block .character_select .ch_fav_icon{
  order:10; display:block !important; position:absolute; right:14px; z-index:2;
  bottom:calc(var(--id-bandh,25px) * 0.8 + 5px);
  width:36%; max-width:130px; height:calc(var(--pv-h,210px) * 0.09); min-height:12px;
  margin:0; padding:0; font-size:0; opacity:.72;
  background-image:repeating-linear-gradient(90deg,
    var(--id-ink,#3c3c42) 0 1px, transparent 1px 3px,
    var(--id-ink,#3c3c42) 3px 5px, transparent 5px 6px,
    var(--id-ink,#3c3c42) 6px 7px, transparent 7px 10px,
    var(--id-ink,#3c3c42) 10px 12px, transparent 12px 13px);
}
/* FontAwesome 会给 fa-star 塞星星图标，这里清掉 */
#rm_print_characters_block .character_select .ch_fav_icon::before{ content:"" !important; display:none !important; }
/* 右侧信息区：一根竖线分开 */
#rm_print_characters_block .character_select .character_select_container{
  position:static; align-self:center; flex:1 1 auto; min-width:0; width:auto; gap:3px;
  min-height:0; max-height:100%; overflow:hidden;
  margin:0; padding-left:13px;
  border-left:1px solid var(--id-line,#cacacf);
  display:flex; flex-direction:column; justify-content:center;
}
/* 大字 STUDENT */
#rm_print_characters_block .character_select .character_select_container::before{
  content:"STUDENT"; order:0; margin-bottom:3px; position:relative; z-index:1;
  font-family:"Arial Black","Helvetica Neue",Arial,sans-serif;
  font-size:min(22px, calc(var(--pv-h,210px) * 0.105)); font-weight:800; letter-spacing:.5px;
  color:var(--id-strong,#5c5c63); line-height:1.15;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
/* 字段标签统一样式：跟值同一行，前面是「中文：」 */
#rm_print_characters_block .character_select .ch_name::before,
#rm_print_characters_block .character_select .tags_inline::before{
  font-size:11px; font-weight:700; letter-spacing:.4px; color:var(--id-label,#8d8d95);
}
/* ① 姓名：角色卡名
   ⚠️ 这里必须是 position:static —— 学号那一行（.ch_additional_info）是名字块的儿子，
      名字块一旦是定位元素，学号就会锚在名字块上（卡片一改高度就飘）；
      名字块本身是 flex 子项，z-index 不需要定位也生效。 */
#rm_print_characters_block .character_select .character_name_block{
  order:1; position:static; z-index:1; margin:0; gap:4px; align-items:baseline; flex-wrap:wrap;
}
#rm_print_characters_block .character_select .ch_name{
  flex:1 1 100%; min-width:0; font-size:var(--pv-name,16px); font-weight:600;
  letter-spacing:.3px; line-height:1.25; color:var(--id-ink,#3c3c42);
}
#rm_print_characters_block .character_select .ch_name::before{ content:"姓名："; margin-right:1px; }
/* ② 班级：标签 */
#rm_print_characters_block .character_select .tags_inline{ order:2; position:relative; z-index:1; margin:0; padding:0; gap:4px; align-items:center; }
#rm_print_characters_block .character_select .tags_inline::before{ content:"班级："; flex:0 0 auto; }
#rm_print_characters_block .character_select .tags_inline .tag{
  font-size:10px; line-height:1.5; padding:0 6px; border-radius:3px;
  border:1px solid var(--id-line,#c6c6cb); color:var(--id-ink,#3c3c42); background:rgba(0,0,0,.03);
}
/* ③ 学号：列表序号（借没人用的 .ch_description 装；简介在证件里不显示） */
#rm_print_characters_block .character_select .ch_description{
  order:3; position:relative; z-index:1; margin:0; padding:0; font-size:0; line-height:1.25;
}
#rm_print_characters_block .character_select .ch_description::before{
  content:"学号：No." counter(stu, decimal-leading-zero);
  display:block; white-space:nowrap;
  font-size:13px; font-weight:600; letter-spacing:.3px; color:var(--id-ink,#3c3c42);
}
#rm_print_characters_block .character_select.is_fav .ch_name{ color:var(--id-ink,#3c3c42); }
#rm_print_characters_block .character_select.is_fav .avatar{
  outline:none; box-shadow:0 0 0 2px var(--golden);
}
    ` },

};

const CARD_STYLE_ORDER = ["raw","cover","side","grid","compact","reveal","stack","halo","student"];

/* ---- 每种样式的出厂参数（切样式时，没动过的旋钮会跟着走）---- */
const CARD_STYLE_META = {
    "cover": {
        "h": 104,
        "gap": 6,
        "radius": 12,
        "name": 15.5,
        "desc": 11.5,
        "hMode": "height"
    },
    "side": {
        "h": 92,
        "gap": 8,
        "radius": 14,
        "name": 15,
        "desc": 11.5,
        "hMode": "height"
    },
    "grid": {
        "h": 200,
        "gap": 8,
        "radius": 12,
        "name": 13.5,
        "desc": 11.5,
        "hMode": "height"
    },
    "compact": {
        "h": 104,
        "gap": 2,
        "radius": 8,
        "name": 13,
        "desc": 11.5,
        "hMode": "scale"
    },
    "reveal": {
        "h": 124,
        "gap": 5,
        "radius": 12,
        "name": 15.5,
        "desc": 11.5,
        "hMode": "height"
    },
    "stack": {
        "h": 78,
        "gap": 6,
        "radius": 14,
        "name": 15.5,
        "desc": 11.5,
        "hMode": "height"
    },
    "halo": {
        "h": 56,
        "gap": 0,
        "radius": 6,
        "name": 15.5,
        "desc": 12,
        "hMode": "height"
    },
    "student": {
        "h": 210,
        "hMin": 150,
        "gap": 9,
        "radius": 4,
        "name": 16,
        "desc": 10.5,
        "hMode": "height"
    }
};

/* ---- 学生证的证件配色 ---- */
const CARD_ID_THEMES = {
    "paper": {
        "name": "纸白",
        "paper": "#f6f6f8",
        "ink": "#3c3c42",
        "band": "#b3b3b9",
        "label": "#8d8d95",
        "line": "#cacacf",
        "strong": "#5c5c63"
    },
    "kraft": {
        "name": "牛皮",
        "paper": "#efe6d5",
        "ink": "#4a3f31",
        "band": "#c2a97f",
        "label": "#8b7a5f",
        "line": "#d8cbb2",
        "strong": "#6b5a42"
    },
    "night": {
        "name": "暗夜",
        "paper": "#1d1f26",
        "ink": "#e6e6ea",
        "band": "#2c2f3a",
        "label": "#9a9aa6",
        "line": "#3a3d48",
        "strong": "#cfd3dc"
    }
};

/* ---- 选项片段（拼装用）---- */
const CARD_OPT = {
    fadeMaskTop: `
/* 图片渐隐：遮罩（自适应任何底色） */
#rm_print_characters_block .avatar img{ -webkit-mask-image:linear-gradient(to top, transparent 0%, #000 var(--pv-fade,58%)); mask-image:linear-gradient(to top, transparent 0%, #000 var(--pv-fade,58%)); }
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
    `,
    fadeMaskRight: `
/* 图片渐隐：遮罩（自适应任何底色） */
#rm_print_characters_block .avatar img{ -webkit-mask-image:linear-gradient(to right, #000 52%, transparent 100%); mask-image:linear-gradient(to right, #000 52%, transparent 100%); }
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
    `,
    fadeSolidTop: `
/* 图片渐隐：色块覆盖（--panel-bg 要换成你面板的实际底色） */
#rm_print_characters_block .character_select::after{
  content:""; position:absolute; inset:0; pointer-events:none; z-index:1;
  background:linear-gradient(to top, var(--panel-bg) 4%, transparent 70%);
}
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
    `,
    fadeSolidRight: `
/* 图片渐隐：色块覆盖（--panel-bg 要换成你面板的实际底色） */
#rm_print_characters_block .character_select::after{
  content:""; position:absolute; inset:0; pointer-events:none; z-index:1;
  background:linear-gradient(to right, var(--panel-bg) 4%, transparent 70%);
}
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
    `,
    colorHover: `
/* 图片颜色：平时半灰，指上去变彩 */
#rm_print_characters_block .avatar img{ filter:grayscale(.45) brightness(.92); }
#rm_print_characters_block .character_select:hover .avatar img{ filter:none; }
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
    `,
    colorGray: `
/* 图片颜色：一直灰 */
#rm_print_characters_block .avatar img{ filter:grayscale(1) brightness(.85); }
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
    `,
    hideDesc: `
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
/* 不显示简介 */
#rm_print_characters_block .ch_description{ display:none; }
    `,
    hideTags: `
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
/* 不显示标签 */
#rm_print_characters_block .tags_inline{ display:none; }
    `,
    hideVer: `
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
/* 不显示版本号 */
#rm_print_characters_block .ch_additional_info{ display:none !important; }
    `,
    hideStar: `
/* 图片取景（偏上 / 居中 / 偏下） */
#rm_print_characters_block .avatar img{ object-position:center var(--pv-focus,32%); }
/* 不显示收藏标记 */
#rm_print_characters_block .is_fav::before,
#rm_print_characters_block .is_fav::after{ display:none; }
#rm_print_characters_block .character_select .ch_fav_icon{ display:none !important; }
    `,
    gridBase: `
/* --------------------------------------------------------------------------
   酒馆自带的 ▦ 网格模式（body.charListGrid）：
   它的选择器权重和上面一样，却会把卡片压成 100px 小方块、并隐藏简介和标签。
   这里把它接管成"两列封面墙"，▦ 有正经效果、上面这套样式也不会被压花。
   想用酒馆原版网格 → 删掉这一小段。
   -------------------------------------------------------------------------- */
body.charListGrid #rm_print_characters_block{
  display:grid; grid-template-columns:1fr 1fr; gap:var(--pv-gap,8px); align-content:start;
}
body.charListGrid #rm_print_characters_block .character_select,
body.charListGrid #rm_print_characters_block .group_select,
body.charListGrid #rm_print_characters_block .bogus_folder_select{
  display:block; position:relative; width:auto; max-width:none; height:var(--pv-h,200px);
  flex-direction:row; align-items:stretch; overflow:hidden; margin:0; border-radius:var(--pv-radius,12px);
}
body.charListGrid #rm_print_characters_block .character_select .avatar{
  position:absolute; inset:0; width:100%; height:100%; border-radius:0;
}
body.charListGrid #rm_print_characters_block .character_select .avatar img{
  width:100%; height:100%; border:0; border-radius:0; box-shadow:none; object-fit:cover;
}
body.charListGrid #rm_print_characters_block .character_select_container{
  position:absolute; left:0; right:0; bottom:0; width:auto; max-width:none; height:auto; padding:8px 9px;
  justify-content:flex-end;
  background:linear-gradient(to top, rgba(0,0,0,.8) 4%, transparent 62%);
}
body.charListGrid #rm_print_characters_block .character_name_block{ flex-direction:row; gap:4px; margin:0; }
body.charListGrid #rm_print_characters_block .character_select .ch_name,
body.charListGrid #rm_print_characters_block .group_select .ch_name{
  width:auto; max-width:none; text-align:left; font-size:13.5px; color:#fff;
}
    `,
};

/* ==== 生成区：角色卡样式数据 结束 ==== */

/* ==========================================================================
   角色卡样式（可选功能）
   --------------------------------------------------------------------------
   样式数据在上面那个「生成区」里（从 角色卡美化-原型.html 生成）。
   这里负责两件事：
     1. 把选中的样式注入成 <style id="ssp_card_css">，参数由抽屉里的旋钮覆盖
     2. 把角色卡头像从 96×144 的缩略图换成原图（/characters/<文件名>）
        —— 酒馆 getThumbnailUrl() 给的是 96×144，铺满整行必然糊
   样式选「原版」→ 撤掉 style 标签 + 头像换回缩略图，一点痕迹都不留。
   ========================================================================== */
const CARD_STYLE_ID = 'ssp_card_css';
/** 记下换过来源的头像（img → 原 src）。WeakMap：列表重画后不会越攒越多 */
const cardOrigSrc = new WeakMap();
/** 所有旋钮的默认值（也是补全旧配置的依据） */
const CARD_DEFAULTS = {
    style: 'cover', hd: true, fade: 'mask', color: 'hover', focus: '32%', align: 'left',
    h: 104, radius: 12, gap: 6, name: 15.5, desc: 11.5, fadeStop: 58, overlay: 20,
    showDesc: true, showTags: true, showVer: true, showStar: true,
    school: '温城大学', year: '2029', idTheme: 'paper', songBg: '#4a2b7d',
};
const CARD_ALIGN_CSS = { left: 'flex-start', center: 'center', right: 'flex-end' };
/** 图片型样式（适合在 ▦ 网格模式下变成封面墙）；其余算"内容型"，网格模式下保持本来的样子 */
const CARD_POSTER_STYLES = ['cover', 'side', 'grid', 'reveal', 'stack'];

function cardStyleSettings() {
    const s = getSettings();
    if (!s.card || typeof s.card !== 'object') s.card = {};
    const c = s.card;
    Object.keys(CARD_DEFAULTS).forEach(k => {
        const d = CARD_DEFAULTS[k];
        if (typeof d === 'boolean') { if (typeof c[k] !== 'boolean') c[k] = d; return; }
        if (typeof d === 'number') { if (typeof c[k] !== 'number' || !isFinite(c[k])) c[k] = d; return; }
        if (typeof c[k] !== 'string' || !c[k]) c[k] = d;
    });
    if (c.style !== 'none' && !CARD_STYLES[c.style]) c.style = CARD_DEFAULTS.style;
    if (!['mask', 'solid', 'none'].includes(c.fade)) c.fade = CARD_DEFAULTS.fade;
    if (!['hover', 'always', 'gray'].includes(c.color)) c.color = CARD_DEFAULTS.color;
    if (!['18%', '32%', '62%'].includes(c.focus)) c.focus = CARD_DEFAULTS.focus;
    if (!CARD_ALIGN_CSS[c.align]) c.align = CARD_DEFAULTS.align;
    if (!CARD_ID_THEMES[c.idTheme]) c.idTheme = CARD_DEFAULTS.idTheme;
    return c;
}

/** 参数块：样式的 var(--pv-*, …) 全靠它生效 */
function cardVarsCSS(c) {
    const t = CARD_ID_THEMES[c.idTheme] || CARD_ID_THEMES.paper || {};
    const idVars = Object.keys(t).filter(k => k !== 'name').map(k => `--id-${k}:${t[k]};`).join(' ');
    return `/* ===== 参数（抽屉里拖旋钮即可，不用动样式本身）===== */
#rm_print_characters_block{
  --pv-gap:${c.gap}px; --pv-radius:${c.radius}px; --pv-h:${c.h}px;
  --pv-name:${c.name}px; --pv-desc:${c.desc}px; --pv-fade:${c.fadeStop}%; --pv-focus:${c.focus};
  --pv-overlay:${c.overlay};
  --id-school:"${String(c.school).replace(/"/g, '')}"; --id-year:"${String(c.year).replace(/"/g, '')}";
  --pv-songbg:${/^#[0-9a-f]{3,8}$/i.test(String(c.songBg)) ? c.songBg : '#4a2b7d'};
  ${idVars}
}
/* 文字对齐 / 字号 / 简介字号（这些不属于任何单个样式，所有样式通用） */
#rm_print_characters_block .character_select .character_select_container{
  align-items:${CARD_ALIGN_CSS[c.align]};
}
#rm_print_characters_block .character_select .ch_description{ font-size:var(--pv-desc,11.5px); }
/* —— 卡片免疫层（只锁「形状 / 边框」，颜色字体仍然跟随主题）——
   酒馆默认是圆形头像：avatar_style=ROUND 时那条 body:not(.big-avatars) .avatar img
   会给头像上 border-radius:50%，主题/美化的 CSS 也可能插一脚；而我们的卡片是**铺满头像元素**的
   → 头像一圆，整张卡就变成大弧线（用户截图里那个）。这里把圆角钉死在「头像容器自己的圆角」上：
   各样式给 .avatar 设多少，图片就继承多少，外部规则再改不动。颜色/字号/阴影一律不碰。 */
#rm_print_characters_block .character_select .avatar img,
#rm_print_characters_block .character_select .avatar img.pointer{
  border-radius:inherit !important; border:0 !important;
}`;
}

/** 按当前旋钮把样式拼出来 */
function cardAssembleCSS(c) {
    const def = CARD_STYLES[c.style];
    if (!def) return '';
    const horiz = c.style === 'side';          // 侧图样式：渐隐方向是横向的
    const parts = [cardVarsCSS(c), def.css];
    /* 学生证不吃渐隐旋钮：证件照不该被渐隐（它的"影子"是右半边那道淡淡的水印），
       照片要的是「扁平 + 照片后阴影」，不是渐变。 */
    const noFade = c.style === 'student';
    if (!noFade && c.fade === 'mask') parts.push(horiz ? CARD_OPT.fadeMaskRight : CARD_OPT.fadeMaskTop);
    if (!noFade && c.fade === 'solid') parts.push(horiz ? CARD_OPT.fadeSolidRight : CARD_OPT.fadeSolidTop);
    if (c.color === 'hover') parts.push(CARD_OPT.colorHover);
    if (c.color === 'gray') parts.push(CARD_OPT.colorGray);
    if (!c.showDesc) parts.push(CARD_OPT.hideDesc);
    if (!c.showTags) parts.push(CARD_OPT.hideTags);
    if (!c.showVer) parts.push(CARD_OPT.hideVer);
    if (!c.showStar) parts.push(CARD_OPT.hideStar);
    /* ---- 卡片间距 / 叠压兜底 ----
       样式本体里各自写着 var(--pv-gap, 本样式默认值)；这里再补一条放最后的规则，
       保证「间距」旋钮对每种样式都有用。
       ⚠️ 非叠层样式的 margin-top 一律写死 0：万一别的规则（或残留的旧样式）带了负边距，
          卡片就会互相压住 —— 那种"层叠"是 bug，不是设计。叠层相册才允许负边距。 */
    if (c.style === 'grid') {
        parts.push(`#rm_print_characters_block{ gap:var(--pv-gap,8px); }`);
        parts.push(`#rm_print_characters_block .character_select{ margin-top:0; }`);
    } else if (c.style === 'stack') {
        // 叠层相册：间距=让开一点，叠压程度=压多少（两个旋钮都能调）
        parts.push(`#rm_print_characters_block .character_select{ margin-top:calc(var(--pv-gap,6px) - 6px - var(--pv-h,78px) * var(--pv-overlay,20) / 100); }`);
    } else {
        parts.push(`#rm_print_characters_block .character_select{ margin-top:0; margin-bottom:var(--pv-gap,6px); flex-wrap:nowrap; overflow:hidden; }`);
    }
    // 酒馆自带的 ▦ 网格模式接管
    //   图片型样式 → 变成"两列封面墙"（好看、也不破坏排版）
    //   内容型样式（紧凑/光环/证件）→ 只把酒馆那套"压成 100px 方块"还原掉，保持本来的样子
    if (CARD_POSTER_STYLES.includes(c.style)) {
        parts.push(CARD_OPT.gridBase);
        parts.push(`body.charListGrid #rm_print_characters_block .ch_description{ display:none; }`);
        parts.push(`body.charListGrid #rm_print_characters_block .tags_inline{ display:${c.showTags ? 'flex' : 'none'}; }`);
        parts.push(`body.charListGrid #rm_print_characters_block .ch_additional_info{ display:${c.showVer ? 'block' : 'none'}; }`);
    } else {
        parts.push(cardGridNeutralCSS(c));
    }
    /* ---- ⚠️ 必须钉住 flex-shrink ----
       卡片是「列方向 flex 容器」里的 flex item，flex-shrink 默认是 1：
       面板列表只有 ~570px 高、里面好几张卡时，浏览器会把每张卡**压缩**到刚好装得下
       （实测 7 张卡被压成 79px），于是「卡片高度」怎么调都没用、内容还会溢出。
       原型里容器高、卡片少，永远不会触发，所以在原型里测不出来。 */
    parts.push(`#rm_print_characters_block .character_select{ flex-shrink:0; }`);
    /* 信息区是 height:100% + padding，不给 border-box 会往外溢几个像素（实测 5px，标签行会被裁掉一点） */
    parts.push(`#rm_print_characters_block .character_select, #rm_print_characters_block .character_select .character_select_container{ box-sizing:border-box; }`);
    /* ⚠️ 酒馆 tags.css 给 .tags.tags_inline 设了 flex-basis:100%。
       面板高度是内容撑的时候百分比会解析成 auto（没事）；但我们的卡片是定高的，
       在列方向 flex 里 100% = 整个信息区高度 → 一排行标签被撑成 119px、把标签挤没了。 */
    parts.push(`#rm_print_characters_block .character_select .tags_inline{ flex-basis:auto; }`);
    /* ---- 卡片高度兜底 ----
       每种样式的"高度怎么用"不一样：铺满型直接给 height；内容是撑开的（光环头像）给 min-height；
       单行紧凑按比例缩（一行的高度不该是 104px）；证件卡给 height + 一个下限，免得压扁。
       同样放最后，保证「卡片高度」旋钮对 8 种样式都有用；▦ 网格模式那边权重更高，也要单独盖一遍。 */
    const meta = CARD_STYLE_META[c.style] || {};
    const hv = 'var(--pv-h,' + (meta.h || CARD_DEFAULTS.h) + 'px)';
    const hRule = meta.hMode === 'scale' ? `min-height:calc(${hv} * 0.32)`
        : meta.hMode === 'min' ? `min-height:${hv}`
            : meta.hMin ? `height:max(${hv}, ${meta.hMin}px)`
                : `height:${hv}`;
    parts.push(`#rm_print_characters_block .character_select{ ${hRule}; }`);
    parts.push(`body.charListGrid #rm_print_characters_block .character_select{ ${hRule}; aspect-ratio:auto; }`);
    /* ---- 触摸设备（手机 / 平板）兜底 ----
       没有 hover：悬停类效果必须改成"直接显示"，否则手机上照片一直半灰、
       「悬停展开」永远展不开。这条放最后，压过上面的 colorHover / 样式本体。 */
    parts.push(cardTouchCSS(c));
    return parts.filter(Boolean).join('\n');
}

/** 触摸设备（没有鼠标悬停）的兜底规则 */
function cardTouchCSS(c) {
    const lines = ['@media (hover: none), (pointer: coarse){',
        '  /* 没有 hover：图片别一直是灰的 */',
        '  #rm_print_characters_block .avatar img{ filter:saturate(1) contrast(1.02); }',
        '  /* hover 才有的位移也去掉（手机上点了会"卡住"） */',
        '  #rm_print_characters_block .character_select:hover{ transform:none; }'];
    if (c.style === 'reveal') {
        lines.push('  /* 悬停展开：触摸设备直接展开，不然永远是一行暗图 */');
        lines.push('  #rm_print_characters_block .character_select{ height:var(--pv-h,124px); }');
        lines.push('  #rm_print_characters_block .character_select .avatar img{ opacity:1; transform:none; }');
        lines.push('  #rm_print_characters_block .character_select .ch_description{ max-height:32px; opacity:.85; }');
        lines.push('  #rm_print_characters_block .character_select .tags_inline{ opacity:1; }');
    }
    lines.push('}');
    return lines.join('\n');
}

/**
 * 内容型样式在 ▦ 网格模式下：把酒馆那套（卡片压成 100px 方块、纵向排列、隐藏简介标签）
 * 还原回本来的排版，别的什么都不动。
 */
function cardGridNeutralCSS(c) {
    return `body.charListGrid #rm_print_characters_block{ display:block; }
body.charListGrid #rm_print_characters_block .character_select,
body.charListGrid #rm_print_characters_block .group_select,
body.charListGrid #rm_print_characters_block .bogus_folder_select{
  display:flex; width:auto; max-width:none; height:auto; flex-direction:row; align-items:center;
  overflow:visible; margin:0 0 var(--pv-gap,6px);
}
body.charListGrid #rm_print_characters_block .character_name_block{ flex-direction:row; gap:5px; margin:0 0 6px; }
body.charListGrid #rm_print_characters_block .character_select .ch_name{
  width:auto; max-width:none; text-align:left; font-size:var(--pv-name,15.5px);
}
body.charListGrid #rm_print_characters_block .character_select_container{
  width:auto; max-width:none; justify-content:flex-start;
}
body.charListGrid #rm_print_characters_block .ch_description{ display:${c.showDesc ? 'block' : 'none'}; }
body.charListGrid #rm_print_characters_block .tags_inline{ display:${c.showTags ? 'flex' : 'none'}; }
body.charListGrid #rm_print_characters_block .ch_additional_info{ display:${c.showVer ? 'block' : 'none'}; }`;
}

/* ==========================================================================
   思维链收纳（Thinking Shield）
   --------------------------------------------------------------------------
   这块是**从老的「🐭 鼠鼠小助手 ShuShu Tweaks」并进来的**（用户要求两个扩展合成一个）。
   原文照搬、只改了设置读取方式（老的是 extension_settings.tavern_tweaks，
   现在统一放在本扩展的设置里，并在 migrateTweaksSettings() 里自动迁移一次）。

   三层防护，把 <think> 之类的思维链从正文挪进酒馆原生的折叠块（extra.reasoning）：
     ① 生成前：generate_interceptor —— 任何生成（普通/续写/重roll/swipe）之前先清聊天记录，
        模型拿到的 prompt 永远不带思维链，根治"续写把思维链吐回正文、格式被冲乱"
     ② 显示时：messageFormatter 钩子（排在正则之前）—— 流式输出时那个没闭合的半截标签
        也不会闪到屏幕上
     ③ 存储层：MESSAGE_RECEIVED / GENERATION_ENDED / CHAT_CHANGED —— 把存量思维链也收纳掉
   思维链**不会被删除**，都在折叠块里点开就能看/能改。
   ========================================================================== */

/** 老扩展的设置键（迁移用；只读不写） */
const TWEAKS_MODULE_NAME = 'tavern_tweaks';

/** 把老的 tavern_tweaks 设置搬过来。
    ⚠️ 只搬一次：标记写在**设置里**（不是内存变量）—— 内存变量每次刷新都会重置，
    那样用户在抽屉里改完、一刷新又被老值盖回去了。 */
function migrateTweaksSettings(s) {
    if (s.tweaksMigrated) return false;
    s.tweaksMigrated = true;
    let moved = 0;
    try {
        const old = getContext()?.extensionSettings?.[TWEAKS_MODULE_NAME];
        if (old && typeof old === 'object') {
            if (typeof old.shieldEnabled === 'boolean') { s.thinkShield = old.shieldEnabled; moved += 1; }
            if (typeof old.cleanHistoryOnChatLoad === 'boolean') { s.thinkOnChatLoad = old.cleanHistoryOnChatLoad; moved += 1; }
            if (typeof old.thinkTags === 'string' && old.thinkTags.trim()) { s.thinkTags = old.thinkTags; moved += 1; }
        }
    } catch (e) { /* 迁不动就算了，用默认值 */ }
    if (moved) log('已从老的「鼠鼠小助手」迁入', moved, '项思维链设置');
    return moved > 0;
}

/** 需要收纳的标签列表 */
function thinkTags() {
    return String(getSettings().thinkTags || 'think,thinking,thought')
        .split(',').map(t => t.trim()).filter(Boolean);
}

function thinkEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 从文本里挑出思维链块，返回清理后的正文（含流式未闭合的半截标签） */
function extractThinking(text, tags) {
    if (typeof text !== 'string' || text.length === 0) return { text, blocks: [], changed: false };
    const list = Array.isArray(tags) && tags.length ? tags : thinkTags();
    const blocks = [];
    let out = text;
    for (const tag of list) {
        const esc = thinkEsc(tag);
        /* 完整闭合的 <tag>…</tag> */
        out = out.replace(new RegExp(`<${esc}\\b[^>]*>([\\s\\S]*?)<\\/${esc}\\s*>`, 'gi'), (_, inner) => {
            if (inner && inner.trim()) blocks.push(inner.trim());
            return '';
        });
        /* 没闭合的 <tag>…（一直到末尾，流式续写时的典型形态） */
        out = out.replace(new RegExp(`<${esc}\\b[^>]*>([\\s\\S]*)$`, 'gi'), (_, inner) => {
            if (inner && inner.trim()) blocks.push(inner.trim());
            return '';
        });
    }
    const cleaned = out.replace(/\n{3,}/g, '\n\n').trim();
    return { text: cleaned, blocks, changed: out !== text };
}

/** 把一条消息里的思维链挪进 extra.reasoning（原地改），返回是否有改动 */
function applyThinkingShield(message) {
    if (!message || message.is_user || message.is_system) return false;
    if (typeof message.mes !== 'string') return false;
    const result = extractThinking(message.mes, thinkTags());
    if (!result.changed) return false;
    message.mes = result.text;
    const joined = result.blocks.join('\n\n').trim();
    if (joined) {
        message.extra = message.extra || {};
        message.extra.reasoning = message.extra.reasoning
            ? `${String(message.extra.reasoning).trim()}\n\n${joined}`
            : joined;
    }
    return true;
}

async function saveChatSafe() {
    const ctx = getContext();
    try {
        if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        else if (typeof ctx?.saveChatConditional === 'function') await ctx.saveChatConditional();
    } catch (e) { warn('保存聊天失败', e); }
}

/** 收纳过思维链、但界面还没重绘的消息 id（重绘后折叠块才会出现） */
const pendingRefreshIds = new Set();

async function refreshMessagesUI() {
    if (pendingRefreshIds.size === 0) return;
    const ctx = getContext();
    const ids = [...pendingRefreshIds];
    pendingRefreshIds.clear();
    try {
        if (typeof ctx?.reloadCurrentChat === 'function') { await ctx.reloadCurrentChat(); return; }
    } catch (e) { warn('reloadCurrentChat 失败，改为逐条刷新', e); }
    const { eventSource, event_types } = ctx ?? {};
    if (!eventSource) return;
    for (const id of ids) {
        try { await eventSource.emit(event_types?.MESSAGE_EDITED ?? 'MESSAGE_EDITED', id); } catch (e) { /* 忽略单条 */ }
    }
}

/** 生成拦截器（manifest.generate_interceptor 指定的全局函数名）
    ⚠️ 名字必须和 manifest.json 里的 generate_interceptor 一致，改了要两边一起改 */
globalThis.shushuPanelInterceptor = async function (chat) {
    try {
        if (!getSettings().thinkShield) return;
        if (!Array.isArray(chat)) return;
        let changed = false;
        for (let i = 0; i < chat.length; i++) {
            if (applyThinkingShield(chat[i])) { changed = true; pendingRefreshIds.add(i); }
        }
        if (changed) await saveChatSafe();
    } catch (e) { warn('生成拦截器出错', e); }
};

/** 显示层兜底：在正则之前把思维链标签剥掉（含流式半截标签）
    ⚠️ 实测：酒馆 1.18.0 **没有** messageFormatter 钩子系统（只有 DOMPurify 的 addHook），
    所以这一层在你这版上是不生效的 —— 老扩展那版也只是默默打了个 warn。
    真正干活的是①生成拦截器 和 ③事件层。这里保留代码：万一以后的酒馆版本提供这个钩子就自动生效。
    替代方案：酒馆自带「高级格式化 → Reasoning → 思维链标签」本身就是原生的显示层剥离（推荐打开）。 */
function registerThinkDisplayHook() {
    const ctx = getContext();
    const formatter = ctx?.messageFormatter;
    if (!formatter || typeof formatter.addHook !== 'function') {
        log('酒馆这版没有 messageFormatter 钩子 → 显示层兜底跳过（①生成前清洗 + ③存储层收纳仍然有效；' +
            '想连流式那半截也不上屏，用酒馆自带的「高级格式化 → Reasoning」）');
        return false;
    }
    formatter.addHook((mes, hookCtx) => {
        try {
            if (!getSettings().thinkShield) return mes;
            if (hookCtx?.isUser || hookCtx?.isSystem || hookCtx?.isReasoning) return mes;
            const r = extractThinking(mes, thinkTags());
            return r.changed ? r.text : mes;
        } catch (e) { return mes; }
    }, {
        stage: formatter.stage?.BEFORE_REGEX ?? 'beforeRegex',
        order: formatter.order?.EARLIEST ?? 0,
    });
    return true;
}

/** 事件层：生成结束 / 收到消息 / 切换聊天时清存量数据 */
function registerThinkEvents() {
    const ctx = getContext();
    const { eventSource, event_types } = ctx ?? {};
    if (!eventSource || !event_types) { warn('拿不到 eventSource，思维链收纳的事件层没启用'); return false; }

    eventSource.on(event_types.MESSAGE_RECEIVED, async mesId => {
        if (!getSettings().thinkShield) return;
        const m = getContext()?.chat?.[mesId];
        if (m && applyThinkingShield(m)) await saveChatSafe();
    });

    eventSource.on(event_types.GENERATION_ENDED, async () => {
        if (!getSettings().thinkShield) return;
        const chat = getContext()?.chat;
        if (!Array.isArray(chat)) return;
        let changed = false;
        /* 只扫尾部几条：续写 / 重 roll 的影响范围都在后面 */
        for (let i = Math.max(0, chat.length - 5); i < chat.length; i++) {
            if (applyThinkingShield(chat[i])) { changed = true; pendingRefreshIds.add(i); }
        }
        if (changed) await saveChatSafe();
        await refreshMessagesUI();
    });

    eventSource.on(event_types.GENERATION_STOPPED, async () => { await refreshMessagesUI(); });

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const s = getSettings();
        if (!s.thinkShield || !s.thinkOnChatLoad) return;
        const chat = getContext()?.chat;
        if (!Array.isArray(chat)) return;
        let changed = false;
        for (let i = 0; i < chat.length; i++) {
            if (applyThinkingShield(chat[i])) { changed = true; pendingRefreshIds.add(i); }
        }
        if (changed) {
            await saveChatSafe();
            await refreshMessagesUI();
            toast('已收纳历史消息里的思维链（点开消息上方的「思考」折叠块就能看/改）', 'info');
        }
    });
    return true;
}

/* ==========================================================================
   导入即更新（把「导入」「替换 / 更新」「从 URL 导入」合成一条路）
   --------------------------------------------------------------------------
   酒馆那三条路打的其实是同一个接口：POST /api/characters/import
     · 不带 preserved_name → 服务端 getPngName() 自动去重：同名卡变成「池尚早1.png」（多一张）
     · 带  preserved_name → 原地覆盖，聊天 / 素材 / 群组都保留
                            （标签是按 avatar 文件名挂在 tag_map 上的，头像名不变 → 标签自然也还在）
   所以这里就干一件事：**先认出这张卡是谁**，再决定带不带 preserved_name。
     · 认出已有角色 → 问一次：更新这一张 / 另存为新角色 / 取消
     · 认不出（新卡）→ 直接导入，什么都不弹
   多文件会逐个来（每次都问；选「另存为」就不会误覆盖）。
   想关掉：抽屉里的「导入即更新」开关，关了就完全是酒馆原样。
   ========================================================================== */
function importMergeOn() { return getSettings().importMerge !== false; }

/** 比名字用：忽略大小写、空白、后缀 */
function importNorm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\.(png|json|yaml|yml|charx|byaf)$/i, ''); }

/** 文件名 → 角色名（池尚早.png → 池尚早） */
function importNameFromFile(file) { return importNorm(file && file.name ? file.name : ''); }

/** 人设文字重合度阈值（用户定：60%）。抽屉里可以调。 */
const IMPORT_SIM_DEFAULT = 0.6;
function importSimThreshold() {
    const v = Number(getSettings().importSimThreshold);
    return (isFinite(v) && v >= 0.2 && v <= 0.95) ? v : IMPORT_SIM_DEFAULT;
}

/** 两段文字的"重合度"：字符二元组 Dice 系数（0~1）。中英文都适用，O(n) 够快。
    先去掉 markdown/标点/空白，避免排版差异影响判断。 */
function importTextSim(a, b) {
    const norm = s => String(s == null ? '' : s).toLowerCase()
        .replace(/[*_`#>|[\]()（）【】「」《》~\-–—\s]+/g, '')
        .replace(/[，。！？；：、,.!?;:"'“”‘’·]/g, '');
    const A = norm(a), B = norm(b);
    if (A.length < 40 || B.length < 40) return 0;      // 太短的不比，交给姓名判断，免得瞎认
    const grams = s => {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
    };
    const ga = grams(A), gb = grams(B);
    if (!ga.size || !gb.size) return 0;
    let inter = 0;
    ga.forEach(g => { if (gb.has(g)) inter += 1; });
    return (2 * inter) / (ga.size + gb.size);
}

/** 卡里的关键信息：姓名 + 人设/描述（一次解析，都拿到） */
async function importCardData(file) {
    const out = { name: '', description: '', personality: '' };
    try {
        const fname = String(file && file.name || '');
        const ext = (fname.match(/\.(\w+)$/) || [, ''])[1].toLowerCase();
        const pick = json => {
            if (!json) return;
            const d = json.data && typeof json.data === 'object' ? json.data : json;
            /* ⚠️ V3 卡里 data.name / data.description 才是当前数据，顶层那份是旧的 V2 镜像
               （实测：顶层叫「🦴几许人是惊世才5.10」，data.name 才是「岑几许」）→ 先取 data 里的 */
            out.name = String(d.name || json.name || '').trim();
            out.description = String(d.description || json.description || '').trim();
            out.personality = String(d.personality || json.personality || '').trim();
        };
        if (ext === 'json') {
            pick(JSON.parse(await file.text()));
            return out;
        }
        if (ext === 'png' && file.slice && file.arrayBuffer) {
            const buf = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
            const bytes = new Uint8Array(buf);
            let latin = '';
            for (let i = 0; i < bytes.length; i += 8192) {
                latin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            }
            /* base64 → 文本。⚠️ 两个坑：
               ① 必须按 UTF-8 解码 —— 直接 atob 得到的是 Latin-1，中文会变「ä½ å」这种乱码
               ② 卡数据后面紧跟 4 字节 CRC，可能也是 base64 字母 → 要按 = 或 %4 截干净，否则 JSON.parse 挂 */
            const decodeCardData = (s) => {
                /* 把 = 一起去掉，再把长度对齐到 4 的倍数 —— atob 就不挑了。
                   （之前按第一个 = 截断，遇到正文里带 = 的卡会截早、JSON.parse 直接挂） */
                let b = String(s).replace(/[^A-Za-z0-9+/]/g, '');
                b = b.slice(0, b.length - (b.length % 4));
                const bin = atob(b);
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                return new TextDecoder('utf-8').decode(u);
            };
            /* ⚠️ PNG 里那块卡数据有两种写法：
               · tEXt：关键字 + \0 + base64
               · iTXt：关键字 + \0 + 压缩标志/方法 + 语言标签\0 + 翻译关键字\0 + base64
               所以别去数 \0。但**也不能让正则随便吃到块尾的 CRC** —— 那几位可能也是 base64 字母，
               结果长度对不齐、atob 直接报 "not correctly encoded"（两张最大的卡就这么读空的）。
               正解：PNG 块结构是 [长度:4][类型:4][数据:长度][CRC:4]，关键字在数据开头，
               所以「数据 = slice(关键字, 关键字 + 长度)」，正好不含 CRC。 */
            const dv = new DataView(buf);
            const grab = (k) => {
                const i = latin.indexOf(k + '\0');
                if (i < 0) return '';
                let len = 0;
                try { len = dv.getUint32(i - 8, false); } catch (e) { len = 0; }   // 大端 u32
                if (!len || len > 2 * 1024 * 1024) len = 900000;                    // 读不到就退化成老办法
                const seg = latin.slice(i, Math.min(i + len, i + 900000));
                const m = /[A-Za-z0-9+/=]{40,900000}/.exec(seg);
                return m ? m[0] : '';
            };
            /* ⚠️ 有些卡的 JSON 是别的工具导出的，字符串里有**裸换行/控制字符** → JSON.parse 直接断
               （实测两张卡就这样）。这里做个字符串感知的修复：只在「字符串内部」把控制字符转义，
               结构性的空白不动。 */
            const fixJson = (t) => {
                let out = '';
                let inStr = false, esc = false;
                for (let i = 0; i < t.length; i++) {
                    const ch = t[i];
                    if (inStr) {
                        if (esc) { out += ch; esc = false; continue; }
                        if (ch === '\\') { out += ch; esc = true; continue; }
                        if (ch === '"') { out += ch; inStr = false; continue; }
                        const code = t.charCodeAt(i);
                        if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
                        out += ch;
                        continue;
                    }
                    if (ch === '"') inStr = true;
                    out += ch;
                }
                return out;
            };
            const parseCard = (text) => {
                try { return JSON.parse(text); } catch (e) { /* 下面修一下再试 */ }
                try { return JSON.parse(fixJson(text)); } catch (e) { return null; }
            };
            /* V3 的 ccv3 才是当前数据，chara 可能只是旧的 V2 镜像 → 优先 ccv3 */
            for (const k of ['ccv3', 'chara']) {
                const b64 = grab(k);
                if (!b64) continue;
                let text = '';
                try { text = decodeCardData(b64); } catch (e) { continue; }
                const json = parseCard(text);
                if (json) {
                    pick(json);
                    if (out.name || out.description) return out;
                }
                /* 兜底：JSON 实在修不好，就按文本抓 —— V3 的 data 段优先 */
                const dataSeg = /"data"\s*:\s*\{[\s\S]{0,600}/.exec(text);
                const mName = /"name"\s*:\s*"([^"]{1,60})"/.exec(dataSeg ? dataSeg[0] : '') ||
                              /"name"\s*:\s*"([^"]{1,60})"/.exec(text);
                if (mName && mName[1] && !out.name) out.name = mName[1].trim();
                const mDesc = /"description"\s*:\s*"([\s\S]{1,60000}?)"\s*[,}]/.exec(dataSeg ? dataSeg[0] : '') ||
                              /"description"\s*:\s*"([\s\S]{1,60000}?)"\s*[,}]/.exec(text);
                if (mDesc && mDesc[1] && !out.description) out.description = mDesc[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                if (out.name || out.description) return out;
            }
        }
    } catch (e) { /* 读不出来就交给文件名兜底 */ }
    return out;
}

/** 只要姓名（老接口，测试里还在用） */
async function importCardName(file) { return (await importCardData(file)).name; }

/** 这张卡是不是已经在库里了？
    ⚠️ 用户指定：**先认卡里的姓名**，再看**人设文字重合度 ≥ 阈值（默认 60%）**，
       都没有才退回文件名。更新时写的是**匹配到的那个角色的头像名**，
       所以卡名/文件名和库里不一致也不会写错文件。 */
function importFindMatch(file, cardName, cardDesc, cardPersonality) {
    const chars = (getContext() && getContext().characters) || [];
    const cn = importNorm(cardName);
    if (cn) {
        const byName = chars.find(c => c && importNorm(c.name) === cn);
        if (byName) return byName;
    }
    if (cardDesc) {
        let best = null, bestSim = 0;
        chars.forEach(c => {
            if (!c) return;
            /* 拿到的正文不一定放在 description —— 有的卡写在 personality 里，两边都比一遍取高的 */
            const s = Math.max(
                importTextSim(cardDesc, c.description || ''),
                importTextSim(cardDesc, c.personality || ''),
                importTextSim(cardPersonality, c.description || ''),
                importTextSim(cardPersonality, c.personality || ''));
            if (s > bestSim) { bestSim = s; best = c; }
        });
        if (best && bestSim >= importSimThreshold()) return best;
    }
    const fn = importNameFromFile(file);
    if (fn) {
        const byFile = chars.find(c => c && importNorm(c.avatar) === fn);
        if (byFile) return byFile;
    }
    return null;
}

/** 这次是按什么认出来的（写进确认弹窗，让用户看得明白） */
function importMatchReason(file, cardName, cardDesc, cardPersonality, match) {
    if (!match) return '';
    const cn = importNorm(cardName);
    if (cn && cn === importNorm(match.name)) return '按卡里的姓名认出来的';
    if (cardDesc || cardPersonality) {
        const sim = Math.max(
            importTextSim(cardDesc, match.description || ''), importTextSim(cardDesc, match.personality || ''),
            importTextSim(cardPersonality, match.description || ''), importTextSim(cardPersonality, match.personality || ''));
        if (sim >= importSimThreshold()) return '按人设文字重合度认出来的（' + Math.round(sim * 100) + '%）';
    }
    const fn = importNameFromFile(file);
    if (fn && fn === importNorm(match.avatar)) return '按文件名认出来的（卡里没读到姓名/人设）';
    return '';
}

/** 用酒馆自己的接口导入（请求形状照抄 script.js 的 importCharacter） */
async function importPost(file, preserveAvatar) {
    const ctx = getContext();
    const ext = (String(file.name || '').match(/\.(\w+)$/) || [, 'png'])[1].toLowerCase();
    const fd = new FormData();
    fd.append('avatar', file);
    fd.append('file_type', ext);
    fd.append('user_name', String((ctx && (ctx.name1 || ctx.userName)) || ''));
    if (preserveAvatar) fd.append('preserved_name', preserveAvatar);
    const headers = (ctx && typeof ctx.getRequestHeaders === 'function')
        ? ctx.getRequestHeaders({ omitContentType: true }) : {};
    const res = await fetch('/api/characters/import', { method: 'POST', body: fd, headers: headers, cache: 'no-cache' });
    if (!res || !res.ok) throw new Error('酒馆拒绝了这次导入（' + (res ? res.status : '网络错误') + '）');
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    return data && data.file_name ? (String(data.file_name).replace(/\.png$/i, '') + '.png') : '';
}

/** 导入完刷新列表（先重取角色数组，再借酒馆自己的「角色列表」重画） */
async function importRefresh() {
    const ctx = getContext();
    try { if (ctx && typeof ctx.getCharacters === 'function') await ctx.getCharacters(); } catch (e) { /* 忽略 */ }
    const btn = document.getElementById('rm_button_characters');
    if (btn && btn.click) btn.click();
    reclaim('import-done');
    return true;
}

/** 这个角色身上挂了哪些标签（名字） */
function importTagsOf(avatar) {
    const ctx = getContext();
    const map = (ctx && ctx.tagMap) || {};
    const defs = (ctx && ctx.tags) || [];
    const ids = map[avatar] || [];
    return ids.map(id => {
        const t = defs.find(x => x && x.id === id);
        return t ? String(t.name || '') : '';
    }).filter(Boolean);
}

/** 弹一次确认：更新 / 另存为新角色 / 取消
    ⚠️ callGenericPopup 是 (内容, 类型, 输入框默认值, 选项) 四个参数 —— 选项写到第 3 个会被无视，
       自定义按钮就不见了、退化成系统默认的「确定 / 否」。POPUP_RESULT.CUSTOM1/2 = 1001/1002。 */
async function importAsk(cardName, existingName, reason, sameName) {
    const ctx = getContext();
    if (!ctx || typeof ctx.callGenericPopup !== 'function') return 'update';
    const R = ctx.POPUP_RESULT || {};
    const UPDATE = R.CUSTOM1 || 1001;
    const NEWONE = R.CUSTOM2 || 1002;
    const TYPE_CONFIRM = (ctx.POPUP_TYPE && ctx.POPUP_TYPE.CONFIRM) || 2;
    const html = `<h3>这张卡已经在库里了</h3>
        <p>卡里的姓名是「<b>${esc(cardName)}</b>」，库里已经有「<b>${esc(existingName)}</b>」了。</p>
        ${reason ? `<p style="opacity:.6;font-size:.85em">（${esc(reason)}）</p>` : ''}
        ${sameName === false ? `<p style="color:#ff9a6a;font-size:.88em">注意：两边<b>姓名不一样</b>，只是文字重合度够 ——
            可能只是模板相似（比如多角色调度卡）。不确定就选「另存为新角色」。</p>` : ''}
        <p style="opacity:.75;font-size:.9em">更新：保留聊天 / 素材 / 群组 / 标签（角色数据按文件里的覆盖）<br>
        另存为新角色：库里会多出一张，老的那张不动</p>`;
    const res = await ctx.callGenericPopup(html, TYPE_CONFIRM, '', {
        okButton: false,
        cancelButton: '取消',
        customButtons: [
            { text: '更新这一张', result: UPDATE, classes: ['popup-button-ok'] },
            { text: '另存为新角色', result: NEWONE },
        ],
        defaultResult: UPDATE,
    });
    /* CONFIRM 弹窗里那颗「确定」= AFFIRMATIVE(1)，让它等于"更新"（和 defaultResult 一致），
       免得用户点了个按钮结果什么都没发生 */
    if (res === UPDATE || res === 1001 || res === 1) return 'update';
    if (res === NEWONE || res === 1002) return 'new';
    return 'cancel';
}

/** 更新卡之前，先记下那些「跟着这张卡走、但存在卡里」的配套数据 ——
    新卡一旦没写这些字段，覆盖之后就没了（局部正则就是这么丢的）。 */
function importSnapshotExtras(ch) {
    const ext = (ch && ch.data && ch.data.extensions) || {};
    return {
        fav: ext.fav === true || ext.fav === 'true',
        world: ext.world || '',
        regex_scripts: Array.isArray(ext.regex_scripts) ? ext.regex_scripts.slice() : [],
        depth_prompt: ext.depth_prompt || null,
        talkativeness: ext.talkativeness,
    };
}

/** 更新完把配套数据补回去。规则：
      · 收藏 = 用户自己标的 → 旧的是 true 就恢复（新卡里的 fav 没意义）
      · 世界书绑定 / 深度提示 / 话痨度 → 新卡有就听新卡，新卡没有就用旧的兜住
      · 局部正则 → **并集**（按 id / scriptName 去重），旧的绝不丢
    写回走酒馆自己的 writeExtensionField（正则扩展存局部正则就是用它），
    它内部是 merge-attributes + 数组整体替换，不会把数组揉成对象。 */
async function importRestoreExtras(avatar, snap) {
    const ctx = getContext();
    if (!ctx) return [];
    /* ⚠️ 关键一步：先把角色列表重新取一遍。
       不然内存里那个对象还是**更新前**的（配套数据还在里面），我一看"没丢"就跳过补写了 ——
       实际盘上已经被新卡覆盖掉了（真机踩过：局部正则/世界书/深度提示全没）。 */
    try { if (typeof ctx.getCharacters === 'function') await ctx.getCharacters(); } catch (e) { /* 忽略 */ }
    const chars = ctx.characters || [];
    const idx = chars.findIndex(c => c && c.avatar === avatar);
    const ch = idx >= 0 ? chars[idx] : null;
    if (!ch || !snap) return [];
    const ext = (ch.data && ch.data.extensions) || {};
    const done = [];
    const write = async (key, value) => {
        try {
            if (ctx && typeof ctx.writeExtensionField === 'function') {
                await ctx.writeExtensionField(idx, key, value);
            } else if (ch.data) {
                ch.data.extensions = ch.data.extensions || {};
                ch.data.extensions[key] = value;
            } else { return; }
            done.push(key);
        } catch (e) { warn('补写 ' + key + ' 失败', e); }
    };
    if (snap.fav && !(ext.fav === true || ext.fav === 'true')) {
        /* ⚠️ 收藏要按酒馆自己的写法补：顶层 fav + data.extensions.fav 一起写，
           还要更新内存里的字段和列表卡片上的 is_fav 星标 —— 只写 extensions.fav 界面不会变 */
        try {
            const headers = (ctx && typeof ctx.getRequestHeaders === 'function') ? ctx.getRequestHeaders() : {};
            await fetch('/api/characters/merge-attributes', {
                method: 'POST', headers: headers,
                body: JSON.stringify({ name: ch.name, avatar: ch.avatar, fav: true, data: { extensions: { fav: true } } }),
            });
            ch.fav = true;
            ch.data = ch.data || {};
            ch.data.extensions = ch.data.extensions || {};
            ch.data.extensions.fav = true;
            const cardEl = document.getElementById('CharID' + idx);
            if (cardEl && cardEl.classList) cardEl.classList.add('is_fav');
            done.push('fav');
        } catch (e) { warn('补写收藏失败', e); }
    }
    if (snap.world && !ext.world) await write('world', snap.world);
    /* 深度提示：新卡里常带一个**空的**默认值 {prompt:'',depth:4,role:'system'} ——
       prompt 是空的就等于没有，别被"有这个对象"骗过去 */
    const newDpEmpty = !ext.depth_prompt || !String(ext.depth_prompt.prompt || '').trim();
    if (snap.depth_prompt && String(snap.depth_prompt.prompt || '').trim() && newDpEmpty) await write('depth_prompt', snap.depth_prompt);
    if (snap.talkativeness !== undefined && ext.talkativeness === undefined) await write('talkativeness', snap.talkativeness);
    if (snap.regex_scripts && snap.regex_scripts.length) {
        const cur = Array.isArray(ext.regex_scripts) ? ext.regex_scripts.slice() : [];
        const keyOf = s => String((s && (s.id || s.scriptName || s.name)) || '');
        const have = new Set(cur.map(keyOf));
        const added = snap.regex_scripts.filter(s => s && keyOf(s) && !have.has(keyOf(s)));
        if (added.length) {
            await write('regex_scripts', cur.concat(added));
            warn('局部正则补回了 ' + added.length + ' 条');
        }
    }
    return done;
}

/** 单张卡走一遍：认卡 → （重复就问） → 导入 → 标签核对 */
async function importHandleFile(file) {
    if (!file || !file.name) return { skipped: true };
    const card = await importCardData(file);
    const cardName = card.name;
    const cardDesc = card.description || card.personality || '';
    const cardPers = card.personality;
    const match = importFindMatch(file, cardName, cardDesc, cardPers);
    let target = '';
    if (match) {
        const sameName = importNorm(cardName) && importNorm(cardName) === importNorm(match.name);
        const choice = await importAsk(cardName || importNameFromFile(file), match.name || match.avatar,
            importMatchReason(file, cardName, cardDesc, cardPers, match), !!sameName);
        if (choice === 'cancel') return { skipped: true };
        if (choice === 'update') target = match.avatar;
    }
    const oldTags = target ? importTagsOf(target) : [];
    const oldExtras = target ? importSnapshotExtras(match) : null;
    const made = await importPost(file, target);
    /* 更新完之后，把「跟着卡走但存在卡里」的配套数据补齐（局部正则 / 收藏 / 世界书绑定…） */
    let restored = [];
    if (target && oldExtras) {
        restored = await importRestoreExtras(made || target, oldExtras);
        if (restored.length) toast('已补回配套数据：' + restored.join('、'), 'info');
    }
    let lostTags = [];
    if (target && oldTags.length) {
        const now = importTagsOf(made || target);
        lostTags = oldTags.filter(t => now.indexOf(t) < 0);
        if (lostTags.length) {
            toast('注意：更新后这几颗标签不在了 —— ' + lostTags.join('、') + '（点一下就能加回来）', 'warning');
        }
    }
    return { file: made, updated: !!target, tags: oldTags, lostTags: lostTags, restored: restored };
}

/** 拦下酒馆原生「导入」：改成走合并流程 */
function onImportFileChange(ev) {
    if (!importMergeOn()) return;
    const input = ev && ev.target;
    if (!input || input.id !== 'character_import_file') return;
    const files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    /* 别让酒馆自己再导一遍 */
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    if (ev.stopPropagation) ev.stopPropagation();
    if (ev.preventDefault) ev.preventDefault();
    try { input.value = ''; } catch (e) { /* 忽略 */ }
    (async () => {
        let upd = 0, add = 0, skip = 0, bad = 0;
        for (const f of files) {
            try {
                const r = await importHandleFile(f);
                if (r.skipped) skip += 1; else if (r.updated) upd += 1; else add += 1;
            } catch (e) { bad += 1; toast('「' + f.name + '」导入失败：' + ((e && e.message) || e), 'error'); }
        }
        await importRefresh();
        const bits = [];
        if (upd) bits.push(upd + ' 张更新');
        if (add) bits.push(add + ' 张新增');
        if (skip) bits.push(skip + ' 张取消');
        if (bad) bits.push(bad + ' 张失败');
        if (bits.length) toast('导入完成：' + bits.join('、'), bad ? 'warning' : 'success');
    })();
}

/** 拦下酒馆原生「从 URL 导入」：也走合并流程（一行一个链接） */
function onUrlImportClick(ev) {
    if (!importMergeOn()) return;
    const t = ev && ev.target;
    const el = (t && t.closest) ? t.closest('#external_import_button, .external_import_button') : null;
    if (!el) return;
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    if (ev.stopPropagation) ev.stopPropagation();
    if (ev.preventDefault) ev.preventDefault();
    (async () => {
        const ctx = getContext();
        let text = '';
        if (ctx && typeof ctx.callGenericPopup === 'function') {
            const TYPE_INPUT = (ctx.POPUP_TYPE && ctx.POPUP_TYPE.INPUT) || 3;
            text = await ctx.callGenericPopup(
                '<h3>从 URL 导入 / 更新</h3><p>一行一个链接；认出重复的卡会问你更新还是另存。</p>',
                TYPE_INPUT, '', { rows: 4, wider: true });
        }
        const urls = String(text || '').split('\n').map(x => x.trim()).filter(Boolean);
        if (!urls.length) return;
        let upd = 0, add = 0, bad = 0;
        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const blob = await res.blob();
                const base = (String(url).split('?')[0].split('/').pop() || 'card.png');
                const f = new File([blob], base, { type: blob.type || 'image/png' });
                const r = await importHandleFile(f);
                if (r.updated) upd += 1; else add += 1;
            } catch (e) { bad += 1; toast('下载失败：' + ((e && e.message) || e), 'error'); }
        }
        await importRefresh();
        const bits = [];
        if (upd) bits.push(upd + ' 张更新');
        if (add) bits.push(add + ' 张新增');
        if (bad) bits.push(bad + ' 张失败');
        toast('URL 导入' + (bits.length ? '：' + bits.join('、') : '已取消'), bad ? 'warning' : 'success');
    })();
}

/** 抽屉里那条「人设重合度阈值」滑块 */
function importMergeRow() {
    const pct = Math.round(importSimThreshold() * 100);
    return `<div class="ssp-crow"><span class="ssp-clabel">人设重合度</span>
        <input class="ssp-crange" type="range" min="30" max="90" step="5" value="${pct}" data-ssp-impsim="1">
        <b class="ssp-cval" data-ssp-impout="1">${pct}%</b></div>`;
}

function bindImportMerge() {
    if (bindImportMerge.done) return false;
    bindImportMerge.done = true;
    /* 捕获阶段先接住，酒馆自己的处理就不会再跑一遍 */
    document.addEventListener('change', onImportFileChange, true);
    document.addEventListener('click', onUrlImportClick, true);
    return true;
}

/** 关掉开关时把监听摘掉（还原成酒馆原样） */
function restoreImportMerge() {
    bindImportMerge.done = false;
    document.removeEventListener('change', onImportFileChange, true);
    document.removeEventListener('click', onUrlImportClick, true);
    return true;
}

/* ==========================================================================
   角色详情页版头（实验 · 默认开）
   --------------------------------------------------------------------------
   酒馆里点开一个角色之后，那个「编辑 / 详情」面板原来是：
     小头像(60×90) + 一排按钮 + 「更多…」下拉，下面才是标签 / 创作者注释 / 角色描述。
   这里把它排成（只有排版变了，功能一个不少）：
      《 角色名 ·············· Token 数        ← 《 在名字左边，不带外框，点了回角色列表
      [⋯][★][🌐][📄][🙂][📤][🗂][💀]          ← ⋯ 把原来那个「更多…」下拉收成一颗
      [  大头像  ]  About.
                    ──────────────
                    姓名  池尚早
                    年龄  22岁   …
   字段从角色卡描述里自动抓：`**姓名：**` / `- 年龄: 21` / YAML / JSON 里
   `"gender": "男"` 都认；抓不到就空着，不硬凑。下面的描述 / 注释原样保留。
   关掉：抽屉里的「角色详情页版头」开关 → 立刻还原成酒馆原样。
   ========================================================================== */
const DETAIL_STYLE_ID = 'ssp_detail_css';
const DETAIL_FLAG = 'data-ssp-detail';
/* 我造出来的节点都记在这儿：还原时直接挨个摘掉，不依赖属性选择器
   （离线测试的假 DOM 只认 #id / .class / 标签） */
const detailNodes = [];

/** 英文键名 → 中文标签（照你卡里常见的那几个） */
const DETAIL_LABELS = {
    name: '姓名', chinese_name: '姓名', alias: '别名', aliases: '别名', nickname: '昵称',
    age: '年龄', age_range: '年龄', gender: '性别', sex: '性别', race: '种族', species: '种族',
    identity: '身份', occupation: '职业', job: '职业', role: '定位', title: '称号', status: '状态',
    height: '身高', weight: '体重', birthday: '生日', birth_date: '生日', zodiac: '星座',
    personality: '性格', trait: '特质', appearance: '外貌', likes: '喜好', dislikes: '讨厌',
    affiliation: '所属', organization: '所属', setting: '设定', world: '世界观', relationship: '关系',
};

function detailEnabled() { return getSettings().detailHeader !== false; }
/** 详情页版头的样式：'about'（About. 字段列）| 'video'（视频观看页那种排版） */
function detailStyle() {
    const v = getSettings().detailStyle;
    return (v === 'video' || v === 'about') ? v : 'about';
}

/** 从角色卡描述里抓「字段：值」（几种常见写法都认） */
function detailFieldPairs(text) {
    let t = String(text || '').replace(/\r/g, '');
    if (!t) return [];
    /* ① **字段：** 值 → 拆成一行一个 */
    t = t.replace(/\*\*\s*([^*：:]{1,14})\s*[:：]\s*\*\*/g, '\n$1：');
    /* ② 被压成一行的 " - 键: 值" 也拆开 */
    t = t.replace(/\s+[-–•]\s+(?=[^:：\n]{1,14}\s*[:：])/g, '\n');
    /* ③ YAML/JSON 那种 "Key: value"（键名可能带引号）粘在一起的也拆开
       ⚠️ 要加 (?<![\w]) 这个前置断言：不然 name 会被从 "me:" 处切开（键名只剩 me） */
    t = t.replace(/(?<![\w$])[ \t]*(?=["']?[A-Za-z_]{2,14}["']?\s*[:：])/g, '\n');
    const out = [];
    const seen = new Set();
    for (const raw of t.split('\n')) {
        let line = String(raw).trim();
        if (!line) continue;
        /* 去掉引号再认：JSON/`{ "name": "x" }` 这种键名带引号，正则过不去 */
        line = line.replace(/^[-*•\s]+/, '').replace(/\*\*/g, '').replace(/["']/g, '')
            .replace(/^[{[]+/, '').trim();
        const m = /^([^:：]{1,14})\s*[:：]\s*(.+)$/.exec(line);
        if (!m) continue;
        const key = m[1].trim();
        const val = m[2].trim()
            .replace(/\*\*/g, '')
            .replace(/^[[{]+/, '').replace(/[\]},;]+$/, '').trim();
        if (!key || !val || val === '{' || val === '[') continue;
        if (val.length > 62) continue;                        // 太长的是正文，不是字段
        if (/^(http|https|www|data|type|version|id|author|creator|character|char)$/i.test(key)) continue;
        const label = DETAIL_LABELS[key.toLowerCase()] || key;
        if (seen.has(label)) continue;
        seen.add(label);
        out.push([label, val]);
        if (out.length >= 8) break;
    }
    return out;
}

/** 视频页皮：给角色详情页**自己造一条顶栏**（不是改酒馆那条）
    《 返回 | 假站名 | Token + 酒馆那几个图标 | 🔍 | 圆头像
    酒馆原来的 #rm_PinAndTabs 在视频页里让位（display:none），里面的图标会被搬进来，功能不丢 */
function buildVideoTopbar(panel) {
    if (!panel || !panel.insertBefore) return false;
    if (panel.querySelector && panel.querySelector('.ssp-vid-bar')) return true;
    const bar = mkel('div', 'ssp-vid-bar');
    setAttr(bar, DETAIL_FLAG, 'vidbar');
    detailNodes.push(bar);

    /* 《 返回：把名字左边那颗搬进来（同一个节点，功能不变） */
    const back = query('#rm_button_selected_ch .ssp-detail-back');
    if (back) bar.append(back);

    /* 假站名（纯玩梗，随时能改） */
    bar.append(mkel('div', 'ssp-vid-logo', '鼠鼠TV'));

    /* 酒馆原来那排 Token + 图标：整个搬进来，功能一个不丢 */
    const info = document.getElementById('result_info');
    if (info) {
        if (!info.__sspHome) info.__sspHome = { parent: info.parentElement, next: info.nextSibling || null };
        bar.append(info);
    }

    /* 🔍 = 搜索 / 管理标签（点酒馆自己的「查看所有标签」） */
    const find = mkel('div', 'ssp-vid-topbtn fa-solid fa-magnifying-glass');
    find.title = '搜索 / 管理标签';
    find.addEventListener?.('click', ev => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        const view = query('#tags_div .tags_view') || query('.tags_view');
        if (view && view.click) view.click();
    });
    bar.append(find);

    /* 圆头像：优先用你自己的（persona），没有就用这张卡的 */
    const userAva = document.getElementById('user_avatar');
    const cardAva = document.getElementById('avatar_load_preview');
    const src = (attrOf(userAva, 'src') || attrOf(cardAva, 'src') || (cardAva && cardAva.src) || '').toString();
    if (src) {
        const round = mkel('div', 'ssp-vid-topava');
        const im = mkel('img', '');
        setAttr(im, 'src', src);
        setAttr(im, 'alt', '');
        round.append(im);
        bar.append(round);
    }

    const first = panel.children && panel.children[0];
    panel.insertBefore(bar, first || null);
    return true;
}

/** 视频页皮：头像当播放器、话题 chips、点赞栏、频道行、订阅、语言 chip
    每个按钮都去点酒馆自己那颗（#favorite_button / #export_button / …），不重写逻辑 */
function buildVideoBlocks(panel, controls, avatarBox) {
    if (!panel || !panel.append) return false;
    const ch = detailCurrentChar();
    const name = (ch && ch.name) || (query('#rm_button_selected_ch h2') || {}).textContent || '这个角色';
    const version = (ch && ch.character_version) || '';
    const tags = (ch && Array.isArray(ch.tags)) ? ch.tags.filter(Boolean) : [];
    const img = document.getElementById('avatar_load_preview');
    const src = (attrOf(img, 'src') || (img && img.src) || '').toString();

    const box = mkel('div', 'ssp-vid-extra');
    setAttr(box, DETAIL_FLAG, 'video');
    detailNodes.push(box);

    /* 标题 + 观看数（= Token 数） */
    box.append(mkel('div', 'ssp-vid-title', name));
    const views = document.querySelector ? document.querySelector('#result_info_total_tokens') : null;
    const permanent = document.querySelector ? document.querySelector('#result_info_permanent_tokens') : null;
    const tok = views && views.textContent ? String(views.textContent).trim() : '';
    const per = permanent && permanent.textContent ? String(permanent.textContent).trim() : '';
    const viewsLine = mkel('div', 'ssp-vid-views',
        tok ? (tok + ' Token 数' + (per ? '（' + per + ' 永久的）' : '') + ' · ' + tags.length + ' 个标签')
            : (tags.length + ' 个标签'));
    box.append(viewsLine);
    /* Token 数是酒馆异步算的：刚点开时多半是 0 —— 过一会儿再补一次 */
    const refreshViews = () => {
        const v2 = document.querySelector ? document.querySelector('#result_info_total_tokens') : null;
        const p2 = document.querySelector ? document.querySelector('#result_info_permanent_tokens') : null;
        const t2 = v2 && v2.textContent ? String(v2.textContent).trim() : '';
        if (!t2 || t2 === '0' || t2 === 'Calculating...') return;
        viewsLine.textContent = t2 + ' Token 数'
            + (p2 && p2.textContent ? '（' + String(p2.textContent).trim() + ' 永久的）' : '')
            + ' · ' + tags.length + ' 个标签';
    };
    try { setTimeout(refreshViews, 1200); setTimeout(refreshViews, 3000); } catch (e) { /* 无所谓 */ }

    /* 点赞栏：一排胶囊按钮，点的是酒馆自己的按钮。
       ⚠️ 胶囊排会横向溢出，所以外面再套一层，把 ⋯ 钉在滚动区**外面** —— 否则它被挤到屏幕外，
          用户根本找不到「更多…」（血泪教训）。 */
    const bar = mkel('div', 'ssp-vid-actions');
    const actionbar = mkel('div', 'ssp-vid-actionbar');
    actionbar.append(bar);
    const pills = [
        ['fa-solid fa-star', '收藏', '#favorite_button'],
        ['fa-solid fa-globe', '世界书', '#world_button'],
        ['fa-solid fa-passport', '聊天书', '.chat_lorebook_button'],
        ['fa-solid fa-book', '高级', '#advanced_div'],
        ['fa-solid fa-face-smile', '人物', '#char_connections_button'],
        ['fa-solid fa-file-export', '导出', '#export_button'],
        ['fa-solid fa-clone', '复制', '#dupe_button'],
        ['fa-solid fa-skull', '删除', '#delete_button'],
    ];
    pills.forEach(([ico, label, sel]) => {
        const pill = mkel('div', 'ssp-vid-pill');
        pill.append(mkel('i', ico));
        pill.append(mkel('span', '', label));
        if (sel === '#favorite_button') { setAttr(pill, DETAIL_FLAG, 'fav-pill'); if (pill.classList) pill.classList.add('ssp-vid-fav-pill'); }
        if (sel === '#delete_button') { setAttr(pill, 'data-ssp-vid-danger', '1'); if (pill.classList) pill.classList.add('danger'); }
        pill.addEventListener?.('click', ev => {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            const btn = document.querySelector ? document.querySelector(sel) : null;
            if (btn && btn.click) btn.click();
            if (sel === '#favorite_button' && panel.classList) {
                panel.classList.toggle('ssp-vid-faved', !panel.classList.contains('ssp-vid-faved'));
                syncVideoFav(panel);
            }
        });
        bar.append(pill);
    });
    box.append(actionbar);

    /* ⋯（更多…）钉在滚动区外面 —— 视频页里酒馆那排图标由 CSS 收起来，不再重复一遍 */
    const moreHolder = (query('#avatar_controls .ssp-detail-more-holder') || query('.ssp-detail-more-holder'));
    if (moreHolder) {
        if (!moreHolder.__sspHome) moreHolder.__sspHome = { parent: moreHolder.parentElement, next: moreHolder.nextSibling || null };
        actionbar.append(moreHolder);
        if (moreHolder.classList) moreHolder.classList.add('ssp-vid-more');
    }

    /* 频道行 = 角色自己 */
    const chan = mkel('div', 'ssp-vid-channel');
    const round = mkel('div', 'ssp-vid-round');
    if (src) {
        const im = mkel('img', '');
        setAttr(im, 'src', src);
        setAttr(im, 'alt', name);
        round.append(im);
    }
    chan.append(round);
    const meta = mkel('div', 'ssp-vid-chanmeta');
    const nm = mkel('div', 'ssp-vid-chan-name', name);
    nm.append(mkel('i', 'fa-solid fa-circle-check'));
    meta.append(nm);
    meta.append(mkel('div', 'ssp-vid-chan-sub', tags.length + ' 个标签 · ' + (version || '未标版本')));
    chan.append(meta);
    box.append(chan);

    /* 两个大按钮：查看详情（滚到描述）+ 订阅（= 收藏） */
    const subs = mkel('div', 'ssp-vid-subs');
    const more = mkel('div', 'ssp-vid-btn ssp-vid-btn-main', '关于我的更多信息');
    more.append(mkel('i', 'fa-solid fa-arrow-up-right-from-square'));
    more.addEventListener?.('click', ev => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        const desc = document.getElementById('descriptionWrapper') || document.getElementById('description_div');
        if (desc && desc.scrollIntoView) desc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const sub = mkel('div', 'ssp-vid-btn ssp-vid-btn-sub');
    sub.append(mkel('i', 'fa-solid fa-user-check'));
    sub.append(mkel('span', 'ssp-vid-sub-tx', '订阅'));
    setAttr(sub, DETAIL_FLAG, 'sub');
    sub.addEventListener?.('click', ev => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        const btn = document.querySelector ? document.querySelector('#favorite_button') : null;
        if (btn && btn.click) btn.click();
        if (panel.classList) panel.classList.toggle('ssp-vid-faved');
        syncVideoFav(panel);
    });
    subs.append(more, sub);
    box.append(subs);

    /* 使用的语言 → 使用的版本 */
    const lang = mkel('div', 'ssp-vid-lang');
    lang.append(mkel('div', 'ssp-vid-lang-title', '使用的版本'));
    const chipRow = mkel('div', 'ssp-vid-lang-chips');
    chipRow.append(mkel('span', 'ssp-vid-chip', version || '未标版本'));
    if (tags.length) {
        const chipRow2 = mkel('div', 'ssp-vid-lang-chips');
        tags.forEach(t => chipRow2.append(mkel('span', 'ssp-vid-chip ssp-vid-chip-tag', '#' + t)));
        lang.append(chipRow, chipRow2);
    } else {
        lang.append(chipRow);
    }
    box.append(lang);

    /* 插在头像区后面（就是「视频」下方那些信息） */
    const wrap = avatarBox.parentElement || panel;
    if (wrap && wrap.insertBefore && avatarBox.nextSibling) wrap.insertBefore(box, avatarBox.nextSibling);
    else if (wrap) wrap.append(box);
    syncVideoFav(panel);
    return true;
}

/** 让「订阅 / 收藏」按钮显示成已订阅（读酒馆自己的 #fav_checkbox） */
function syncVideoFav(panel) {
    const fav = document.getElementById('fav_checkbox');
    const on = panel && panel.classList
        ? panel.classList.contains('ssp-vid-faved') || (fav && String(fav.value) === 'true')
        : false;
    if (!panel || !panel.querySelector) return false;
    const tx = panel.querySelector('.ssp-vid-sub-tx');
    const btn = panel.querySelector('.ssp-vid-btn-sub');
    if (tx) tx.textContent = on ? '已订阅' : '订阅';
    if (btn && btn.classList) btn.classList.toggle('on', !!on);
    const pill = panel.querySelector('.ssp-vid-fav-pill');
    if (pill && pill.classList) pill.classList.toggle('on', !!on);
    return true;
}

/** 视频页：像素级不重要，排版对齐那张图就够 */
const VIDEO_CSS = `
/* 视频页：酒馆那排图标收起来（功能全并进上面的胶囊排，不再重复一遍），⋯ 也跟着胶囊排 */
#rm_ch_create_block.ssp-detail-video #avatar_controls > .form_create_bottom_buttons_block{
  display:none !important; }
#rm_ch_create_block.ssp-detail-video #avatar_controls{ padding:0 !important; min-height:0 !important; }
.ssp-vid-actionbar .ssp-detail-more-holder{ margin:0 !important; width:34px !important; height:30px !important; flex:0 0 auto !important; }
/* 视频页：酒馆那条 tab（名字/Token/图标）让位、换成详情页自己的顶栏 —— 默认关（用户说不如原来的） */
#right-nav-panel.ssp-detail-video-top #rm_PinAndTabs{ display:none !important; }
/* 详情页自己的顶栏 */
.ssp-vid-bar{
  display:flex !important; align-items:center !important; gap:8px !important;
  padding:2px 2px 9px !important; margin:0 0 2px !important;
  border-bottom:1px solid rgba(128,128,128,.3) !important; }
.ssp-vid-bar .ssp-detail-back{ margin:0 2px 0 0 !important; }
.ssp-vid-logo{
  font-size:16.5px; font-weight:800; letter-spacing:.2px; line-height:1;
  color:var(--SmartThemeBodyColor,#fff); flex:0 0 auto; }
.ssp-vid-bar #result_info{ margin-left:auto !important; font-size:10.5px !important; opacity:.62 !important; }
.ssp-vid-bar #result_info_text{ font-size:10.5px !important; line-height:1.2 !important; white-space:nowrap; }
.ssp-vid-bar #result_info .right_menu_button{
  width:24px !important; height:22px !important; display:flex !important; align-items:center !important;
  justify-content:center !important; border-radius:6px !important; }
.ssp-vid-bar #result_info .right_menu_button:hover{ background:rgba(128,128,128,.22) !important; }
.ssp-vid-topbtn{ width:26px; height:24px; flex:0 0 auto; display:flex; align-items:center;
  justify-content:center; border-radius:7px; cursor:pointer; font-size:11.5px;
  background:rgba(128,128,128,.16); }
.ssp-vid-topbtn:hover{ background:rgba(128,128,128,.32); }
.ssp-vid-topava{ width:24px; height:24px; flex:0 0 auto; border-radius:50%; overflow:hidden;
  background:rgba(128,128,128,.2); }
.ssp-vid-topava img{ width:100%; height:100%; object-fit:cover; display:block; }
#rm_ch_create_block.ssp-detail-video #tags_div{ order:-1 !important; margin:0 0 10px !important; }
#rm_ch_create_block.ssp-detail-video #tags_div .tag{
  border-radius:999px !important; padding:3px 10px !important; font-size:12px !important; }
#rm_ch_create_block.ssp-detail-video #avatar_div{
  display:block !important; width:100% !important; }
#rm_ch_create_block.ssp-detail-video #avatar_div > #avatar_div_div{
  display:block !important; width:100% !important; max-width:none !important; min-width:0 !important;
  height:auto !important; max-height:none !important; }
#rm_ch_create_block.ssp-detail-video #avatar_div_div > #avatar_load_preview{
  width:100% !important; height:auto !important; aspect-ratio:16/9 !important;
  object-fit:cover !important; object-position:center 22% !important;
  border-radius:12px !important; box-shadow:0 10px 30px rgba(0,0,0,.5) !important; }
.ssp-vid-extra{ display:flex; flex-direction:column; gap:9px; padding:10px 0 2px; }
.ssp-vid-title{ font-size:16px; font-weight:700; line-height:1.35; color:var(--SmartThemeBodyColor,#fff); }
.ssp-vid-views{ font-size:11.5px; opacity:.6; }
.ssp-vid-actionbar{ display:flex !important; align-items:center !important; gap:6px !important; min-width:0; }
.ssp-vid-actions{ display:flex; gap:7px; padding:1px 0 3px; scrollbar-width:none;
  flex:1 1 auto !important; min-width:0 !important;
  /* ⚠️ 这里**不能**只做横向滚动：面板只有 ~430px，一排放不下 8 颗胶囊，
     最后几颗（导出/复制/删除）会滚到屏幕外 → 用户直接以为"删除功能没了"（真翻车过）。
     改成自动换行：一排放不下就换第二排，8 颗永远都看得见。 */
  flex-wrap:wrap !important; overflow:visible !important;
  -webkit-mask-image:none !important; mask-image:none !important; }
.ssp-vid-actions::-webkit-scrollbar{ display:none; }
.ssp-vid-pill{ display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; cursor:pointer;
  padding:6px 12px; border-radius:999px; font-size:12px;
  background:rgba(128,128,128,.16); border:1px solid rgba(128,128,128,.22); }
.ssp-vid-pill:hover{ background:rgba(128,128,128,.3); }
.ssp-vid-pill.on{ background:rgba(255,190,60,.22); border-color:rgba(255,190,60,.5); }
.ssp-vid-channel{ display:flex; align-items:center; gap:10px; }
.ssp-vid-round{ width:36px; height:36px; border-radius:50%; overflow:hidden; flex:0 0 auto;
  background:rgba(128,128,128,.2); }
.ssp-vid-round img{ width:100%; height:100%; object-fit:cover; display:block; }
.ssp-vid-chanmeta{ min-width:0; }
.ssp-vid-chan-name{ font-size:13.5px; font-weight:600; display:flex; align-items:center; gap:5px; }
.ssp-vid-chan-name i{ font-size:11px; opacity:.6; }
.ssp-vid-chan-sub{ font-size:11px; opacity:.55; margin-top:1px; }
.ssp-vid-subs{ display:flex; gap:8px; flex-wrap:wrap; }
.ssp-vid-btn{ display:inline-flex; align-items:center; gap:7px; cursor:pointer; font-size:12.5px;
  padding:8px 16px; border-radius:999px; border:1px solid rgba(128,128,128,.24); }
.ssp-vid-btn:hover{ background:rgba(128,128,128,.2); }
.ssp-vid-btn-main{ background:rgba(255,168,0,.85); border-color:transparent; color:#1a1200; font-weight:600; }
.ssp-vid-btn-main:hover{ background:rgba(255,180,30,.95); }
.ssp-vid-btn-sub{ background:rgba(128,128,128,.18); }
.ssp-vid-btn-sub.on{ background:rgba(128,128,128,.3); border-color:rgba(128,128,128,.5); }
.ssp-vid-lang{ margin-top:2px; }
.ssp-vid-lang-title{ font-size:12.5px; opacity:.75; margin-bottom:5px; }
.ssp-vid-lang-chips{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:5px; }
.ssp-vid-chip{ font-size:11.5px; padding:4px 10px; border-radius:8px;
  background:rgba(128,128,128,.16); border:1px solid rgba(128,128,128,.2); }
.ssp-vid-chip-tag{ border-radius:999px; }
`;

function mkel(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
}

/** 当前面板里打开的是哪个角色（先看隐藏字段，再退回名字匹配） */
function detailCurrentChar() {
    const ctx = getContext();
    const list = (ctx && ctx.characters) || [];
    const fileEl = document.getElementById('avatar_url_pole');
    const file = (fileEl && (fileEl.value || attrOf(fileEl, 'value'))) || '';
    if (file) {
        const byFile = list.find(c => c && c.avatar === file);
        if (byFile) return byFile;
    }
    const nameEl = document.getElementById('character_name_pole');
    const name = (nameEl && (nameEl.value || attrOf(nameEl, 'value'))) || '';
    if (name) {
        const byName = list.find(c => c && c.name === name);
        if (byName) return byName;
    }
    const h2 = query('#rm_button_selected_ch h2');
    const shown = h2 && h2.textContent ? String(h2.textContent).trim() : '';
    return (shown && list.find(c => c && c.name === shown)) || null;
}

/** 拼「About. + 字段列 + 标签」那块 */
function detailAboutBlock(ch) {
    const box = mkel('div', 'ssp-about');
    setAttr(box, DETAIL_FLAG, 'about');
    box.append(mkel('h3', 'ssp-about-title', 'About.'));
    box.append(mkel('div', 'ssp-about-rule'));
    const pairs = detailFieldPairs(ch && ch.description ? ch.description : '');
    if (pairs.length) {
        const list = mkel('div', 'ssp-about-list');
        pairs.forEach(([k, v]) => {
            const row = mkel('div', 'ssp-about-row');
            row.append(mkel('span', 'ssp-about-k', k));
            row.append(mkel('span', 'ssp-about-v', v));
            list.append(row);
        });
        box.append(list);
    } else {
        box.append(mkel('div', 'ssp-about-empty', '这张卡里没写「字段：值」结构，这里就空着（不硬凑）'));
    }
    const tags = (ch && Array.isArray(ch.tags)) ? ch.tags.filter(Boolean) : [];
    if (tags.length) {
        const tl = mkel('div', 'ssp-about-tags');
        tags.forEach(t => tl.append(mkel('span', 'ssp-about-tag', '#' + t)));
        /* #标签要贴在**头像正下方**：不搬 DOM（搬了会被别的流程挪回去），
           只把头像底边量出来写进 --ssp-tagtop，CSS 绝对定位把它摆到那儿。 */
        const measureTagTop = () => {
            try {
                const av = document.getElementById('avatar_div_div');
                const box2 = document.getElementById('avatar_div');
                if (av && box2 && box2.style && box2.style.setProperty) {
                    const top = av.getBoundingClientRect().bottom - box2.getBoundingClientRect().top + 8;
                    if (top > 0) box2.style.setProperty('--ssp-tagtop', Math.round(top) + 'px');
                }
            } catch (e) { /* 量不到就用 CSS 默认值 */ }
        };
        measureTagTop();
        /* ⚠️ 首次加载时头像可能还没排版（高度 0）→ 量的值会偏上。下一帧再量一次兜住。 */
        try { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measureTagTop); } catch (e) { }
        box.append(tl);
    }
    return box;
}

const DETAIL_CSS = `
/* ① 名字左边那颗《：没有外框，就是个符号 */
#rm_button_selected_ch{ display:flex; align-items:center; }
#rm_button_selected_ch .ssp-detail-back{
  flex:0 0 auto; margin:0 8px 0 0; padding:0; border:0; background:none; box-shadow:none;
  color:var(--SmartThemeBodyColor, #eee); opacity:.6; font-size:18px; font-weight:600;
  line-height:1.3; letter-spacing:-1px; cursor:pointer; user-select:none; }
#rm_button_selected_ch .ssp-detail-back:hover{ opacity:1; }
/* ② 版头排布：名字行 / 按钮排 / [大头像 | About]
   ⚠️ 这几条一律加 !important：实测酒馆（+美化里的自定义 CSS）会把 #avatar_controls
      变成 flex-direction:column（按钮排竖着 499px 高），还会把 #avatar_div 顶到面板外，
      不加权压不住 —— 这里是纯排版，压过去不会影响功能。 */
#avatar-and-name-block{ display:flex !important; flex-direction:column !important; align-items:stretch !important; }
#avatar-and-name-block > #avatar_controls{
  display:flex !important; flex-direction:row !important; flex-wrap:wrap !important;
  width:100% !important; height:auto !important; min-height:0 !important;
  justify-content:flex-end !important; padding:2px 0 8px !important; }
#avatar-and-name-block > .flex-container.flexFlowColumn.expander{ width:100% !important; }
#avatar_div{
  display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
  align-items:flex-start !important; justify-content:flex-start !important; gap:14px !important;
  width:100% !important; height:auto !important; }
#avatar_div > #avatar_div_div{
  flex:0 0 auto !important; position:static !important; width:38% !important;
  max-width:230px !important; min-width:96px !important; margin:0 !important;
  /* ⚠️ 酒馆给这个头像框写死了 height:90px，图放大后会溢出框外、把下面的内容盖住 */
  height:auto !important; max-height:none !important; }
#avatar_div_div > #avatar_load_preview{ display:block !important; }
#avatar_div_div > #avatar_load_preview{
  width:100% !important; height:auto !important; max-width:100% !important;
  aspect-ratio:3/4; object-fit:cover; object-position:center 22%;
  border-radius:4px; box-shadow:0 10px 26px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.06); }
/* ③ ⋯：原生下拉「看起来」是一颗按钮（select 透明但照样能点，弹出的是系统原生菜单） */
.ssp-detail-more-holder{
  position:relative !important; flex:0 0 auto !important;
  width:34px !important; height:30px !important; min-width:0 !important;
  margin:0 6px 0 0 !important; padding:0 !important;
  display:flex !important; align-items:center !important; justify-content:center !important;
  border-radius:9px !important; overflow:hidden !important; cursor:pointer;
  border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.16)) !important;
  background:rgba(128,128,128,.12) !important; }
.ssp-detail-more-holder::after{
  content:"⋯"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  padding-bottom:7px; font-size:17px; font-weight:700; line-height:1;
  color:var(--SmartThemeBodyColor, #eee); pointer-events:none; }
.ssp-detail-more-holder:hover{ background:rgba(128,128,128,.26) !important; }
.ssp-detail-more-holder > #char-management-dropdown{
  position:absolute !important; inset:0 !important; width:100% !important; height:100% !important;
  min-width:0 !important; margin:0 !important; padding:0 !important; border:0 !important;
  opacity:0 !important; cursor:pointer; }
/* ④ About. 那块 */
#avatar_div .ssp-about{ flex:1 1 auto; min-width:0; padding-top:2px; }#avatar_div .ssp-about-title{
  margin:0; font:700 30px/1.05 Georgia,"Times New Roman","Songti SC",serif; letter-spacing:.5px;
  color:var(--SmartThemeBodyColor, #fff); }
#avatar_div .ssp-about-rule{
  height:2px; margin:7px 0 10px;
  background:linear-gradient(90deg, currentColor, transparent 96%); opacity:.5; }
#avatar_div .ssp-about-list{ display:flex; flex-direction:column; gap:1px; }
#avatar_div .ssp-about-row{
  display:flex; gap:8px; align-items:baseline; padding:3px 0;
  border-bottom:1px dashed rgba(128,128,128,.28); }
#avatar_div .ssp-about-row:last-child{ border-bottom:0; }
#avatar_div .ssp-about-k{ flex:0 0 46px; font-size:11.5px; letter-spacing:.6px; opacity:.55; }
#avatar_div .ssp-about-v{ flex:1 1 auto; min-width:0; font-size:13px; line-height:1.45;
  overflow:hidden; text-overflow:ellipsis; }
#avatar_div .ssp-about-empty{ font-size:11.5px; opacity:.45; padding:2px 0 4px; }
#avatar_div{ position:relative; }
/* #标签：绝对定位到头像正下方（--ssp-tagtop 由 JS 量出头像底边写入），不再跟着字段列表走 */
#avatar_div .ssp-about-tags{ display:flex; flex-wrap:wrap; gap:5px; position:absolute; left:0; top:var(--ssp-tagtop, 230px); margin:0; padding:0; z-index:2; max-width:100%; }
#avatar_div .ssp-about-tag{
  font-size:11px; padding:2px 8px; border-radius:6px; opacity:.85;
  border:1px solid rgba(128,128,128,.45); background:rgba(128,128,128,.12); }
/* ⑤ 标签区：芯片居左、＋ / 🔍 / 🏷 在右；搜索-新建的输入框平时收起来
      （每颗标签右边的 × 是酒馆自己的 .tag_remove，点了真的会从角色卡上删） */
#tags_div{ display:flex !important; flex-wrap:wrap !important; align-items:flex-start !important;
  gap:6px !important; margin:0 !important; }
#tags_div > #tagList{ order:1 !important; flex:1 1 auto !important; min-width:0 !important;
  display:flex !important; flex-wrap:wrap !important; justify-content:flex-start !important;
  align-items:center !important; gap:6px !important; margin:0 !important; min-height:24px !important; }
#tags_div > #tagList:empty::after{ content:"还没有标签"; font-size:11.5px; opacity:.4; }
#tags_div > .ssp-tag-actions{ order:2 !important; flex:0 0 auto !important; display:flex !important;
  align-items:center !important; gap:5px !important; margin:0 !important; }
#tags_div > .tag_controls{ order:3 !important; flex:1 1 100% !important; width:100% !important;
  display:none !important; margin:0 !important; }
#tags_div.ssp-tags-editing > .tag_controls{ display:flex !important; }
#tags_div .ssp-tag-btn{ width:27px; height:27px; display:flex; align-items:center; justify-content:center;
  border-radius:8px; cursor:pointer; font-size:11.5px;
  border:1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.16)); background:rgba(128,128,128,.12); }
#tags_div .ssp-tag-btn:hover{ background:rgba(128,128,128,.28); }
#tags_div .ssp-tag-btn.on{ background:rgba(128,128,128,.34); }
#tags_div .tag{ display:inline-flex !important; align-items:center !important; gap:6px !important;
  margin:0 !important; cursor:default !important; }
#tags_div .tag .tag_remove{ display:inline-block !important; opacity:.5 !important;
  font-size:11px !important; cursor:pointer !important; transition:opacity .15s ease, color .15s ease; }
#tags_div .tag .tag_remove:hover{ opacity:1 !important; color:#ff6b81 !important; }
/* ⑥ 操作区收纳：去框 + 按用途分三组 + ⋯ 归位到最右。
     ⚠️ 只动 CSS 的 order / 边框，按钮的 DOM 位置和点击逻辑一律不碰 */
#avatar_controls .form_create_bottom_buttons_block{
  display:flex !important; flex-wrap:wrap !important; align-items:center !important; }
#avatar_controls .form_create_bottom_buttons_block .menu_button{
  border:0 !important; background:transparent !important; box-shadow:none !important;
  border-radius:8px !important; opacity:.82; transition:background .15s ease, opacity .15s ease; }
#avatar_controls .form_create_bottom_buttons_block .menu_button:hover{
  background:rgba(128,128,128,.2) !important; opacity:1; }
/* ① 用这张卡：★收藏 / 🌐世界书 / 📇聊天世界书 */
#avatar_controls #favorite_button{ order:1 !important; }
#avatar_controls #world_button{ order:2 !important; }
#avatar_controls .chat_lorebook_button{ order:3 !important; }
/* ② 编辑资料：📖高级定义 / 🙂连接人物 */
#avatar_controls #advanced_div{ order:11 !important; }
#avatar_controls #char_connections_button{ order:12 !important; }
/* ③ 文件：📤导出 / ⧉复制 / ☠删除 */
#avatar_controls #export_button{ order:21 !important; }
#avatar_controls #dupe_button{ order:22 !important; }
#avatar_controls #delete_button{ order:23 !important; }
/* ⋯（更多…）永远在最右 */
#avatar_controls .ssp-detail-more-holder{ order:99 !important; }
/* 组间那两条竖线：给每组第一颗加左边框 */
#avatar_controls #advanced_div, #avatar_controls #export_button{
  border-left:1px solid rgba(128,128,128,.38) !important;
  border-radius:0 8px 8px 0 !important;
  margin-left:6px !important; padding-left:6px !important; }
/* 危险操作单独标红 */
#avatar_controls #delete_button{ color:#ff7a8a !important; }
#avatar_controls #delete_button:hover{ background:rgba(255,90,110,.22) !important; }
/* 标签区那三颗按钮也去框 */
#tags_div .ssp-tag-btn, #tags_div .tags_view{
  border:0 !important; background:transparent !important; opacity:.78;
  transition:background .15s ease, opacity .15s ease; }
#tags_div .ssp-tag-btn:hover, #tags_div .tags_view:hover{
  background:rgba(128,128,128,.22) !important; opacity:1; }
#tags_div .ssp-tag-btn.on{ background:rgba(128,128,128,.26) !important; opacity:1; }
/* 危险动作（删除）在视频页里也给个红调，别混在普通胶囊里 */
.ssp-vid-pill.danger, .ssp-vid-pill[data-ssp-vid-danger="1"]{ color:#ff9ea9; }
/* ⑦ 两个小节标题稍微收一收，和上面的衬线标题搭一点 */
#rm_ch_create_block #description_div, #rm_ch_create_block #creators_notes_div{ letter-spacing:.4px; }
`;

/** 标签区：收起 / 展开那个「搜索-新建」输入框（酒馆自己那个 input 就带自动补全，不用重写） */
function tagInputRow() { return query('#tags_div > .tag_controls') || query('#tags_div .tag_controls'); }
function openTagInput(mode) {
    const tags = document.getElementById('tags_div');
    const row = tagInputRow();
    const input = document.getElementById('tagInput');
    if (!tags || !row || !row.classList) return false;
    const open = tags.classList.contains('ssp-tags-editing');
    const same = row.__sspMode === mode;
    if (open && same) { closeTagInput(); return true; }        // 同一个按钮再点一次 = 收起
    row.__sspMode = mode;
    tags.classList.add('ssp-tags-editing');
    if (input) {
        if (input.placeholder !== undefined) {
            input.placeholder = (mode === 'search') ? '搜索标签…' : '输入新标签，回车添加…';
        }
        try { input.focus?.(); } catch (e) { /* 无所谓 */ }
    }
    return true;
}
function closeTagInput() {
    const tags = document.getElementById('tags_div');
    const input = document.getElementById('tagInput');
    if (tags && tags.classList) tags.classList.remove('ssp-tags-editing');
    if (input && input.__sspPh !== undefined && input.placeholder !== undefined) input.placeholder = input.__sspPh;
    return true;
}

/** 标签区改造：芯片居左、＋/🔍 在右、× 常亮（都只在「详情页版头」开着时生效） */
function applyTagTools() {
    const tags = document.getElementById('tags_div');
    const list = document.getElementById('tagList');
    const row = tagInputRow();
    if (!tags || !list || !row) return false;

    let bar = tags.querySelector ? tags.querySelector('.ssp-tag-actions') : null;
    if (!bar) {
        bar = mkel('div', 'ssp-tag-actions');
        setAttr(bar, DETAIL_FLAG, 'tagbar');
        /* 酒馆自己的「查看所有标签」按钮搬过来一起用（不删功能） */
        const view = row.querySelector ? row.querySelector('.tags_view') : null;
        if (view) {
            if (!view.__sspHome) view.__sspHome = { parent: view.parentElement, next: view.nextSibling || null };
            bar.append(view);
        }
        const find = mkel('div', 'ssp-tag-btn fa-solid fa-magnifying-glass');
        find.title = '搜索标签';
        const plus = mkel('div', 'ssp-tag-btn fa-solid fa-plus');
        plus.title = '加标签（输入后回车）';
        const sync = () => {
            const on = !!(tags.classList && tags.classList.contains('ssp-tags-editing'));
            if (find.classList) find.classList.toggle('on', on && row.__sspMode === 'search');
            if (plus.classList) plus.classList.toggle('on', on && row.__sspMode === 'add');
        };
        find.addEventListener?.('click', ev => {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            openTagInput('search');
            sync();
        });
        plus.addEventListener?.('click', ev => {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            openTagInput('add');
            sync();
        });
        bar.append(find, plus);
        detailNodes.push(bar);
        if (tags.insertBefore) tags.insertBefore(bar, list.nextSibling || null);
        else tags.append(bar);
    }

    /* Esc 收起输入框；记住原来那个 placeholder 以便还原 */
    const input = document.getElementById('tagInput');
    if (input && !input.__sspTagKeys) {
        input.__sspTagKeys = true;
        input.__sspPh = input.placeholder === undefined ? '' : input.placeholder;
        input.addEventListener?.('keydown', ev => {
            if (ev && ev.key === 'Escape') { if (ev.stopPropagation) ev.stopPropagation(); closeTagInput(); }
        });
    }
    return true;
}

function applyDetailHeader() {
    if (!detailEnabled()) { restoreDetailHeader(); return false; }
    const block = document.getElementById('avatar-and-name-block');
    const controls = document.getElementById('avatar_controls');
    const avatarBox = document.getElementById('avatar_div');
    if (!block || !controls || !avatarBox) return false;

    /* ---- 样式（幂等；换版头样式时也要把内容刷成新的） ---- */
    let st = document.getElementById(DETAIL_STYLE_ID);
    if (!st) {
        st = document.createElement('style');
        st.id = DETAIL_STYLE_ID;
        (document.head || document.body).append(st);
    }
    const wantCss = DETAIL_CSS + VIDEO_CSS;
    if (st.textContent !== wantCss) st.textContent = wantCss;

    /* ---- ① 《 放到名字左边 ---- */
    const nameRow = document.getElementById('rm_button_selected_ch');
    if (nameRow && !nameRow.querySelector('.ssp-detail-back')) {
        const back = mkel('div', 'ssp-detail-back', '《');
        setAttr(back, DETAIL_FLAG, 'back');
        back.title = '返回角色列表';
        detailNodes.push(back);
        back.addEventListener?.('click', ev => {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            const btn = document.getElementById('rm_button_characters') || document.getElementById('rm_button_back');
            if (btn && btn.click) btn.click();
        });
        const anchor = nameRow.firstChild || (nameRow.children && nameRow.children[0]) || null;
        if (nameRow.insertBefore) nameRow.insertBefore(back, anchor);
        else nameRow.append(back);
    }

    /* ---- ② 按钮排挪到名字下面（原来是跟头像挤一行） ---- */
    if (controls.parentElement !== block) {
        if (!controls.__sspHome) controls.__sspHome = { parent: controls.parentElement, next: controls.nextSibling || null };
        const first = block.children && block.children[0];
        if (block.insertBefore && first) block.insertBefore(controls, first); else block.append(controls);
    }

    /* ---- ③ ⋯：把「更多…」下拉埋进按钮排
       ⚠️ 不要用 showPicker() + display:none：Chrome 对 display:none 的 select 会抛
          InvalidStateError，兜底又会把它显示出来 → 变成"先冒出下拉栏、再冒出选择框"。
          改成：原生 select 保持渲染（透明、铺满、照样能点），弹出的就是系统原生菜单；
          长得像 ⋯ 由外面那个 label 的 ::after 画。一行 JS 都不用。 ---- */
    const sel = document.getElementById('char-management-dropdown');
    if (sel) {
        const holder = sel.closest ? sel.closest('label') : null;
        if (holder && holder.classList && holder.classList.add) {
            holder.classList.add('ssp-detail-more-holder');
            /* 位置交给 CSS 的 order:99（天然就在按钮排最后面），
               所以不动 DOM —— 少一次搬家就少一次还原风险 */
        }
    }

    /* ---- ④ 版头主体：About. 字段列 / 视频页那种排版 ---- */
    const panel = document.getElementById('rm_ch_create_block');
    const mode = detailStyle();
    const navPanel = document.getElementById('right-nav-panel');
    if (panel && panel.classList) {
        panel.classList.toggle('ssp-detail-about', mode !== 'video');
        panel.classList.toggle('ssp-detail-video', mode === 'video');
    }
    /* 顶栏在 #rm_ch_create_block 外面，所以同一套皮也要挂到 #right-nav-panel 上。
       ⚠️ 视频页「自己造顶栏」那套已经按用户要求还原了：默认不启用（getSettings().detailTopbar === true
          才开），酒馆原来那条 #rm_PinAndTabs 照常显示。代码留着，想再试把那个开关打开即可。 */
    const wantTopbar = (mode === 'video') && (getSettings().detailTopbar === true);
    if (navPanel && navPanel.classList) {
        navPanel.classList.toggle('ssp-detail-video', mode === 'video');
        navPanel.classList.toggle('ssp-detail-video-top', wantTopbar);
    }
    const oldTop = navPanel && navPanel.querySelector ? navPanel.querySelector('.ssp-vid-top') : null;
    if (oldTop && oldTop.remove) oldTop.remove();
    /* ⚠️ 顺序：先把上一轮建的清掉，**再**建新的。反过来的话刚建好就被当旧节点删了 */
    const oldAbout = avatarBox.querySelector ? avatarBox.querySelector('.ssp-about') : null;
    if (oldAbout && oldAbout.remove) oldAbout.remove();
    const oldVid = panel && panel.querySelector ? panel.querySelector('.ssp-vid-extra') : null;
    /* ⚠️ 拆「视频页那块」之前，先把搬进去的 ⋯（更多…）下拉壳救出来放回按钮排，
       否则它会跟着旧容器一起脱离 DOM，getElementById 再也找不到（这坑踩第二次了） */
    if (oldVid) {
        const holder0 = oldVid.querySelector ? oldVid.querySelector('.ssp-detail-more-holder') : null;
        if (holder0 && holder0.__sspHome) {
            const h = holder0.__sspHome;
            try {
                if (h.next && h.next.parentElement === h.parent) h.parent.insertBefore(holder0, h.next);
                else h.parent.append(holder0);
            } catch (e) { /* 找不回就算了 */ }
            delete holder0.__sspHome;
        }
        if (oldVid.remove) oldVid.remove();
    }
    const oldBar = panel && panel.querySelector ? panel.querySelector('.ssp-vid-bar') : null;
    /* ⚠️ 拆旧顶栏之前，先把住进去的酒馆原生元素（Token + 那排图标）救出来放回原位，
       否则它会跟着旧顶栏一起脱离 DOM，getElementById 再也找不到 */
    if (oldBar) {
        const info0 = (oldBar.querySelector ? oldBar.querySelector('#result_info') : null) || document.getElementById('result_info');
        if (info0 && info0.__sspHome) {
            const h = info0.__sspHome;
            try {
                if (h.next && h.next.parentElement === h.parent) h.parent.insertBefore(info0, h.next);
                else h.parent.append(info0);
            } catch (e) { /* 找不回就算了 */ }
            delete info0.__sspHome;
        }
        if (oldBar.remove) oldBar.remove();
    }
    /* 建新的 */
    if (wantTopbar) buildVideoTopbar(panel);
    if (mode === 'video') {
        buildVideoBlocks(panel, controls, avatarBox);
    } else {
        const about = detailAboutBlock(detailCurrentChar());
        const avatarLabel = document.getElementById('avatar_div_div');
        if (avatarLabel && avatarLabel.parentElement === avatarBox && avatarLabel.nextSibling && avatarBox.insertBefore) {
            avatarBox.insertBefore(about, avatarLabel.nextSibling);
        } else {
            avatarBox.append(about);
        }
    }

    /* ---- ⑤ 标签区：芯片居左 + ＋/🔍 在右 + × 常亮 ---- */
    applyTagTools();
    return true;
}

function restoreDetailHeader() {
    /* ⚠️ 顺序很重要：先把搬过位置的原生元素放回去，**再**摘我加的节点。
       反过来的话，原生按钮跟着我的容器一起被摘掉，就再也找不回来了
       （「查看所有标签」按钮就踩过这个坑）。 */
    const putBack = (el, home) => {
        if (!el || !home || !home.parent) return;
        try {
            if (home.next && home.next.parentElement === home.parent) home.parent.insertBefore(el, home.next);
            else home.parent.append(el);
        } catch (e) { /* 面板已经不存在就算了 */ }
    };
    const controls = document.getElementById('avatar_controls');
    if (controls && controls.__sspHome) { putBack(controls, controls.__sspHome); delete controls.__sspHome; }
    const viewBtn = query('#tags_div .tags_view') || query('.tags_view');
    if (viewBtn && viewBtn.__sspHome) { putBack(viewBtn, viewBtn.__sspHome); delete viewBtn.__sspHome; }
    const selEl0 = document.getElementById('char-management-dropdown');
    const holderEl0 = selEl0 && selEl0.closest ? selEl0.closest('label') : null;
    if (holderEl0 && holderEl0.__sspHome) { putBack(holderEl0, holderEl0.__sspHome); delete holderEl0.__sspHome; }
    /* 视频页顶栏里搬进来的「Token + 那排图标」也要先放回酒馆那条 tab 上 */
    const infoEl = document.getElementById('result_info');
    if (infoEl && infoEl.__sspHome) { putBack(infoEl, infoEl.__sspHome); delete infoEl.__sspHome; }
    const navEl = document.getElementById('right-nav-panel');
    if (navEl && navEl.classList) {
        navEl.classList.remove('ssp-detail-video');
        navEl.classList.remove('ssp-detail-video-top');
    }

    /* 收起展开状态 + 恢复 placeholder */
    const tagsDiv = document.getElementById('tags_div');
    if (tagsDiv && tagsDiv.classList) tagsDiv.classList.remove('ssp-tags-editing');
    const panelEl = document.getElementById('rm_ch_create_block');
    if (panelEl && panelEl.classList) {
        panelEl.classList.remove('ssp-detail-about');
        panelEl.classList.remove('ssp-detail-video');
        panelEl.classList.remove('ssp-vid-faved');
    }
    const tagIn = document.getElementById('tagInput');
    if (tagIn && tagIn.__sspPh !== undefined && tagIn.placeholder !== undefined) tagIn.placeholder = tagIn.__sspPh;

    /* 最后摘掉我造的节点和样式 */
    const st = document.getElementById(DETAIL_STYLE_ID);
    if (st && st.remove) st.remove();
    while (detailNodes.length) {
        const el = detailNodes.pop();
        if (el && el.remove) el.remove();
    }
    queryAll('.ssp-detail-back, .ssp-about, .ssp-detail-more').forEach(el => { if (el.remove) el.remove(); });
    queryAll('.ssp-detail-more-holder').forEach(el => el.classList && el.classList.remove && el.classList.remove('ssp-detail-more-holder'));
    return true;
}

/**
 * 头像高清化：把 /thumbnail?type=avatar&file=xxx 换成 /characters/xxx（原图）。
 * 文件名直接从现有 src 的 file= 参数里拿，所以不依赖 data-chid、也不依赖 title 属性。
 */
/** 把角色简介洗成一句话，给「歌单行」第二行用（CSS 拿不到 textContent） */
function cardLineText(el) {
    const s = String((el && el.textContent) || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[*_`#>|~\[\]()「」]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/['"]/g, '')
        .trim();
    return s.length > 42 ? s.slice(0, 42) + '…' : s;
}

/**
 * 给每张卡写两个变量（CSS 里拿不到 img 的 src / 元素里的文字）：
 *   --ssp-avatar 学生证右边那道图片影子
 *   --ssp-line   歌单行第二行那句简介
 */
function setCardAvatarVars() {
    let n = 0;
    queryAll('#rm_print_characters_block .character_select').forEach(card => {
        const img = card.querySelector ? card.querySelector('.avatar img') : null;
        const src = attrOf(img, 'src') || '';
        if (!src || !card.style || !card.style.setProperty) return;
        const val = 'url("' + src + '")';
        const line = "'" + cardLineText(card.querySelector ? card.querySelector('.ch_description') : null) + "'";
        const same = card.style.getPropertyValue
            && card.style.getPropertyValue('--ssp-avatar') === val
            && card.style.getPropertyValue('--ssp-line') === line;
        if (same) return;
        card.style.setProperty('--ssp-avatar', val);
        card.style.setProperty('--ssp-line', line);
        n += 1;
    });
    return n;
}

/** 颜色旋钮（目前是歌单行的底色）：实时改 CSS，persist 时才落盘 */
function setCardColor(key, value, persist, wrapEl) {
    const c = cardStyleSettings();
    c[key] = String(value == null ? '' : value).trim();
    if (wrapEl && typeof wrapEl.querySelector === 'function') {
        const out = wrapEl.querySelector('[data-ssp-card-out="' + key + '"]');
        if (out) out.textContent = c[key];
    }
    applyCardStyle();
    if (persist) save();
    return c[key];
}

/** 卡片属于哪个角色文件（原图 /characters/xxx 和缩略图 ?file=xxx 两种都认） */
function cardAvatarFile(card) {
    const img = card && card.querySelector ? card.querySelector('.avatar img') : null;
    const src = String((img && (attrOf(img, 'src') || img.src)) || '');
    if (src.indexOf('/characters/') >= 0) {
        const tail = src.split('/characters/')[1] || '';
        try { return decodeURIComponent(tail); } catch (e) { return tail; }
    }
    const m = /[?&]file=([^&]+)/.exec(src);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    return '';
}

/** 点列表卡片上的 ★ = 收藏 / 取消收藏（走酒馆自己的 merge-attributes，和右键菜单同一条路） */
async function toggleCardFav(card) {
    if (!card) return null;
    const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx || typeof fetch !== 'function') return null;
    const file = cardAvatarFile(card);
    const ch = (ctx.characters || []).find(x => x && x.avatar === file);
    if (!ch) { toast('没找到这张卡（' + file + '）', 'warning'); return null; }
    const next = !(ch.fav === true || ch.fav === 'true');
    try {
        const headers = typeof ctx.getRequestHeaders === 'function'
            ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const res = await fetch('/api/characters/merge-attributes', {
            method: 'POST', headers: headers,
            body: JSON.stringify({ name: ch.name, avatar: ch.avatar, data: { extensions: { fav: next } }, fav: next }),
        });
        if (!res || !res.ok) { toast('收藏没存上，酒馆拒绝了这次请求', 'error'); return null; }
    } catch (e) { toast('收藏失败：' + ((e && e.message) || e), 'error'); return null; }
    ch.fav = next;
    if (card.classList && card.classList.toggle) card.classList.toggle('is_fav', next);
    toast(next ? '已收藏「' + ch.name + '」' : '已取消收藏「' + ch.name + '」', 'success');
    return next;
}

/** 列表上的 ★：在捕获阶段接住，免得同一戳又顺手把角色打开了 */
function onFavStarClick(ev) {
    const t = ev && ev.target;
    const star = (t && t.closest) ? t.closest('#rm_print_characters_block .ch_fav_icon') : null;
    if (!star) return;
    if (sortMode) return;                                  // 排序模式里别抢拖拽
    if (ev.preventDefault) ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    const card = star.closest ? star.closest('.character_select') : null;
    if (card) toggleCardFav(card);
}

function bindFavStar() {
    const list = document.getElementById('rm_print_characters_block');
    if (!list || !list.addEventListener || bindFavStar.done) return false;
    bindFavStar.done = true;
    list.addEventListener('click', onFavStarClick, true);
    return true;
}

function hdCardAvatars(on) {
    const imgs = queryAll('#rm_print_characters_block .character_select .avatar img');
    let n = 0;
    imgs.forEach(img => {
        const cur = attrOf(img, 'src') || '';
        if (on) {
            if (!cardOrigSrc.has(img)) cardOrigSrc.set(img, cur);
            const m = /[?&]file=([^&]+)/.exec(cur);
            if (!m) return;                                  // 不是缩略图地址就别乱动
            const hd = '/characters/' + m[1];                // m[1] 本身已是 URL 编码
            if (cur !== hd) { setAttr(img, 'src', hd); n += 1; }
            setAttr(img, 'loading', 'lazy');                 // 屏幕外的先不加载
            setAttr(img, 'decoding', 'async');
        } else {
            const orig = cardOrigSrc.get(img);
            if (orig && cur !== orig) { setAttr(img, 'src', orig); n += 1; }
            cardOrigSrc.delete(img);
        }
    });
    return n;
}

/** 换样式：没动过的旋钮跟着新样式的出厂参数走，自己调过的保留 */
const CARD_KNOBS = ['h', 'gap', 'radius', 'name', 'desc'];
function switchCardStyle(next) {
    const c = cardStyleSettings();
    const prev = CARD_STYLE_META[c.style] || {};
    const nx = CARD_STYLE_META[next] || {};
    CARD_KNOBS.forEach(k => {
        if (typeof nx[k] !== 'number') return;
        const untouched = typeof prev[k] !== 'number' || Math.abs(Number(c[k]) - prev[k]) < 0.001;
        if (untouched) c[k] = nx[k];
    });
    c.style = next;
    return c;
}

/** 把配置变成现实（幂等）。样式=原版时连 style 标签一起撤掉。 */
function applyCardStyle() {
    const c = cardStyleSettings();
    const def = CARD_STYLES[c.style];
    const el = document.getElementById(CARD_STYLE_ID);
    if (!def) {
        if (el) el.remove();
        hdCardAvatars(false);
        return { style: 'none', hd: 0, css: 0 };
    }
    const css = '/* 鼠鼠小助手 · 角色卡样式：' + def.name + ' */\n' + cardAssembleCSS(c);
    let node = el;
    if (!node) {
        node = document.createElement('style');
        node.id = CARD_STYLE_ID;
        (document.head || document.body).append(node);
    }
    node.textContent = css;
    const hd = hdCardAvatars(c.hd);
    setCardAvatarVars();
    return { style: c.style, hd, css: css.length };
}
/** 关扩展 / 恢复原版时用：撤样式 + 头像还原 */
function restoreCardStyle() {
    const el = document.getElementById(CARD_STYLE_ID);
    if (el) el.remove();
    hdCardAvatars(false);
}

/* ==========================================================================
   手动排序：拖拽角色卡，自定义顺序
   --------------------------------------------------------------------------
   顺序的 key 用「头像文件名」（稳定，不受酒馆排序/翻页影响）。
   拖完存进 settings.cardOrder，酒馆每次重画 / 翻页后都会重新套用。
   不在你顺序表里的角色（比如新导入的）保持酒馆自己的顺序、排在后面。
   桌面直接拖；手机上长按 250ms 再拖（不然手指一碰就抢走滚动）。
   ========================================================================== */
const SORT_CLASS = 'ssp-sorting';
const SORT_HINT_ID = 'ssp_sort_hint';
const CARD_GHOST_ID = 'ssp_card_ghost';
let sortMode = false;
let cardDrag = null;
let cardHoldTimer = null;

/** 读卡片对应的头像文件名。三种来源都兼容：缩略图地址 / 原图地址 / title 里的 File: */
function cardAvatarOf(card) {
    if (!card) return '';
    const img = card.querySelector ? card.querySelector('.avatar img') : null;
    const av = card.querySelector ? card.querySelector('.avatar') : null;
    const src = attrOf(img, 'src') || '';
    let m = /[?&]file=([^&]+)/.exec(src);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    m = /\/characters\/([^/?#]+)/.exec(src);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    const title = attrOf(av, 'title') || '';
    m = /File:\s*(.+?)\s*$/m.exec(title);
    if (m) return m[1].trim();
    const chid = card.dataset ? card.dataset.chid : null;
    const chars = getContext() ? getContext().characters : null;
    if (chid != null && chars && chars[chid] && chars[chid].avatar) return chars[chid].avatar;
    return '';
}
function cardEls() { return queryAll('#rm_print_characters_block .character_select'); }

/** 读取 / 规范化顺序设置 */
function cardOrderSettings() {
    const s = getSettings();
    if (!Array.isArray(s.cardOrder)) s.cardOrder = [];
    s.cardOrder = s.cardOrder.filter(x => typeof x === 'string' && x);
    if (typeof s.useCardOrder !== 'boolean') s.useCardOrder = true;
    return s;
}

/** 按设置里的顺序重排渲染出来的卡片（幂等；顺序没变就不动 DOM） */
function applyCardOrder() {
    const list = query('#rm_print_characters_block');
    if (!list) return 0;
    const s = cardOrderSettings();
    const cards = cardEls();
    if (!cards.length || !s.useCardOrder || !s.cardOrder.length) return 0;
    const rank = new Map();
    s.cardOrder.forEach((a, i) => { if (!rank.has(a)) rank.set(a, i); });
    const sorted = cards.map((el, i) => {
        const a = cardAvatarOf(el);
        return { el, r: rank.has(a) ? rank.get(a) : 1e9 + i };
    }).sort((a, b) => a.r - b.r).map(x => x.el);
    if (sorted.every((el, i) => el === cards[i])) return 0;   // 已经对了
    sorted.forEach(el => list.append(el));
    return sorted.length;
}

/**
 * 把当前 DOM 顺序存进设置。
 * 只保存出现过的卡片、但保留表里其它角色的位置：
 *   [这一页的新顺序] + [表里没出现在这一页的，按原表顺序]
 */
function saveCardOrder() {
    const s = cardOrderSettings();
    const visible = cardEls().map(cardAvatarOf).filter(Boolean);
    const seen = new Set(visible);
    s.cardOrder = visible.concat(s.cardOrder.filter(a => !seen.has(a)));
    save();
    return s.cardOrder.length;
}

/** 清空自定义顺序 */
function clearCardOrder() {
    const s = cardOrderSettings();
    s.cardOrder = [];
    save();
    applyCardOrder();
    return true;
}

function removeSortHint() {
    const el = document.getElementById(SORT_HINT_ID);
    if (el) el.remove();
}
function insertSortHint() {
    if (document.getElementById(SORT_HINT_ID)) return;
    const host = query('#charListFixedTop') || query('#rm_characters_block');
    if (!host) return;
    const bar = document.createElement('div');
    bar.id = SORT_HINT_ID;
    bar.className = 'ssp-sorthint';
    bar.innerHTML = '<i class="fa-solid fa-arrows-up-down-left-right"></i>'
        + '<span>拖动角色卡调整顺序（手机长按再拖）</span><span class="ssp-sp"></span>'
        + '<span class="menu_button ssp-sortdone" data-ssp-sortdone="1">完成</span>';
    bar.addEventListener('click', ev => { if (ev.target.closest('[data-ssp-sortdone]')) setSortMode(false); });
    if (host.prepend) host.prepend(bar); else host.append(bar);
}

/** 进入 / 退出拖拽排序模式 */
function setSortMode(on) {
    sortMode = Boolean(on);
    if (document.body && document.body.classList) document.body.classList.toggle(SORT_CLASS, sortMode);
    removeSortHint();
    if (sortMode) {
        insertSortHint();
        toast('拖动角色卡调整顺序；点「完成」退出', 'info');
    }
    queryAll('#ssp_btn_reorder').forEach(el => { if (el.classList) el.classList.toggle('on', sortMode); });
    return sortMode;
}

function cardGhost(card) {
    let g = document.getElementById(CARD_GHOST_ID);
    if (!g) {
        g = document.createElement('div');
        g.id = CARD_GHOST_ID;
        g.className = 'ssp-ghost';
        if (document.body && document.body.appendChild) document.body.appendChild(g);
    }
    const name = card.querySelector ? card.querySelector('.ch_name') : null;
    g.textContent = (name && name.textContent ? name.textContent : '角色').slice(0, 14);
    return g;
}
function removeCardGhost() {
    const g = document.getElementById(CARD_GHOST_ID);
    if (g) g.remove();
}
function moveCardGhost(x, y) {
    const g = document.getElementById(CARD_GHOST_ID);
    if (!g) return;
    if (g.style) { g.style.left = x + 'px'; g.style.top = (y - 22) + 'px'; }
}

/** 拖动中：把被拖的卡插到鼠标位置对应的卡片前面/后面（实时重排） */
function reorderByPointer(clientY) {
    if (!cardDrag) return;
    const card = cardDrag.el;
    const list = query('#rm_print_characters_block');
    if (!list) return;
    const others = cardEls().filter(el => el !== card);
    let target = null;
    for (const el of others) {
        const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        if (!r) continue;
        if (clientY < r.top + r.height / 2) { target = el; break; }
    }
    if (target) {
        if (target.previousElementSibling === card) return;
        if (target.insertAdjacentElement) target.insertAdjacentElement('beforeBegin', card);
        else if (list.insertBefore) list.insertBefore(card, target);
    } else {
        const last = others[others.length - 1];
        if (!last || last.nextElementSibling === card) return;
        if (last.insertAdjacentElement) last.insertAdjacentElement('afterEnd', card);
        else if (list.append) list.append(card);
    }
}

function startCardDrag(card, x, y) {
    cardDrag = { el: card };
    if (card.classList) card.classList.add('ssp-card-dragging');
    cardGhost(card);
    moveCardGhost(x, y);
}
function moveCardDrag(x, y) {
    if (!cardDrag) return;
    moveCardGhost(x, y);
    reorderByPointer(y);
}
function endCardDrag() {
    if (cardHoldTimer) { clearTimeout(cardHoldTimer); cardHoldTimer = null; }
    if (!cardDrag) return;
    const card = cardDrag.el;
    cardDrag = null;
    if (card.classList) card.classList.remove('ssp-card-dragging');
    removeCardGhost();
    const n = saveCardOrder();
    toast('顺序已保存（' + n + ' 个角色）', 'success');
    applyCardOrder();       // 套用一次，确保和存下来的表一致
}

/** 卡片上的按下：桌面立即拖，触摸长按再拖 */
function onListPointerDown(e) {
    if (!sortMode || cardDrag) return;
    const card = e.target && e.target.closest ? e.target.closest('.character_select') : null;
    if (!card) return;
    const isTouch = e.pointerType && e.pointerType !== 'mouse';
    const startX = e.clientX, startY = e.clientY;
    const begin = () => {
        cardHoldTimer = null;
        startCardDrag(card, startX, startY);
        try { e.preventDefault && e.preventDefault(); } catch (err) { /* 无妨 */ }
    };
    if (!isTouch) { begin(); attachCardDragListeners(startX, startY, true); return; }
    if (cardHoldTimer) clearTimeout(cardHoldTimer);
    cardHoldTimer = globalThis.setTimeout ? globalThis.setTimeout(begin, TOUCH_HOLD_MS) : null;
    attachCardDragListeners(startX, startY, false);
}
function attachCardDragListeners(startX, startY, immediate) {
    const onMove = ev => {
        if (cardDrag) { moveCardDrag(ev.clientX, ev.clientY); try { ev.preventDefault && ev.preventDefault(); } catch (e) { /* 无妨 */ } return; }
        if (!immediate && (Math.abs(ev.clientX - startX) > TOUCH_SLOP || Math.abs(ev.clientY - startY) > TOUCH_SLOP)) {
            if (cardHoldTimer) { clearTimeout(cardHoldTimer); cardHoldTimer = null; }   // 在滚动，不是长按
        }
    };
    const onUp = () => {
        document.removeEventListener && document.removeEventListener('pointermove', onMove);
        document.removeEventListener && document.removeEventListener('pointerup', onUp);
        document.removeEventListener && document.removeEventListener('pointercancel', onUp);
        endCardDrag();
    };
    document.addEventListener && document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener && document.addEventListener('pointerup', onUp);
    document.addEventListener && document.addEventListener('pointercancel', onUp);
}

/** 排序模式下别让点卡片打开角色 */
function blockCardClick(e) {
    if (!sortMode) return;
    if (e.target && e.target.closest && e.target.closest('.character_select')) {
        try { e.stopPropagation(); e.preventDefault(); } catch (err) { /* 无妨 */ }
    }
}

/* ==========================================================================
   设置
   ========================================================================== */
function getSettings() {
    const store = getContext()?.extensionSettings;
    if (!store) return { schemaVersion: SCHEMA_VERSION, enabled: true, devices: { desktop: defaultLayout('desktop'), mobile: defaultLayout('mobile') } };
    if (!store[MODULE_NAME] || typeof store[MODULE_NAME] !== 'object') store[MODULE_NAME] = {};
    const s = store[MODULE_NAME];

    if (typeof s.enabled !== 'boolean') s.enabled = true;
    /* 角色详情页版头（About 版）：老配置没这个字段 → 默认开 */
    if (typeof s.detailHeader !== 'boolean') s.detailHeader = true;
    if (s.detailStyle !== 'video' && s.detailStyle !== 'about') s.detailStyle = 'about';
    /* 导入即更新（合并 导入 / 替换 / URL导入）：默认开 */
    if (typeof s.listNotesFirstLine !== 'boolean') s.listNotesFirstLine = true;
    /* 悬浮球（鼠鼠口袋）：默认开；位置存 orbPos（会校验）；番外存在 notes 里 */
    if (typeof s.orbOn !== 'boolean') s.orbOn = true;
    /* ⚠️ orbPos 现在是 {right,bottom}（离边距离）；老的 {x,y} 也放行一次，由 mountOrb 换算 */
    if (s.orbPos && typeof s.orbPos.right !== 'number' && typeof s.orbPos.x !== 'number') s.orbPos = null;
    if (!Array.isArray(s.notes)) s.notes = [];   // 列表里的作者注释只显示第一行
    if (typeof s.importMerge !== 'boolean') s.importMerge = true;
    if (typeof s.importSimThreshold !== 'number') s.importSimThreshold = IMPORT_SIM_DEFAULT;
    /* 思维链收纳（从老的「鼠鼠小助手 ShuShu Tweaks」并进来的功能）
       ⚠️ 迁移必须写在默认值**之前**：默认值先把字段填上的话，迁移就永远不生效了。
       迁移标记也要存进设置里（只迁一次），否则每次刷新都会把用户的改动覆盖回去。 */
    migrateTweaksSettings(s);
    if (typeof s.thinkShield !== 'boolean') s.thinkShield = true;
    if (typeof s.thinkOnChatLoad !== 'boolean') s.thinkOnChatLoad = true;
    if (typeof s.thinkTags !== 'string' || !s.thinkTags.trim()) s.thinkTags = 'think,thinking,thought';
    if (!s.devices || typeof s.devices !== 'object') s.devices = {};
    ['desktop', 'mobile'].forEach(dev => {
        const cur = s.devices[dev];
        if (!cur || !Array.isArray(cur.modules) || !cur.zones) { s.devices[dev] = defaultLayout(dev); return; }
        // 补齐：新按钮/新分区在旧配置里也要能用
        const def = defaultLayout(dev);
        const knownModules = new Set(cur.modules.map(m => m.id));
        def.modules.forEach(dm => { if (!knownModules.has(dm.id)) cur.modules.push(JSON.parse(JSON.stringify(dm))); });
        cur.modules.forEach(m => {
            if (!Array.isArray(m.rows) || !m.rows.length) m.rows = [[]];
            m.rows = m.rows.map(r => (Array.isArray(r) ? r : []));
        });
        ZONE_IDS.forEach(z => { if (!Array.isArray(cur.zones[z])) cur.zones[z] = def.zones[z].slice(); });
        // 清掉已经不存在的模块 id 和按钮 id
        const knownBtns = new Set(BUTTONS.map(b => b.id));
        const modIds = new Set(cur.modules.map(m => m.id));
        cur.modules.forEach(m => { m.rows = m.rows.map(r => r.filter(id => knownBtns.has(id))); });
        ZONE_IDS.forEach(z => { cur.zones[z] = cur.zones[z].filter(id => modIds.has(id)); });
        // 对齐方式：老配置没有这个字段 → 一律当「左」
        cur.modules.forEach(m => { if (!ALIGNS.includes(m.align)) m.align = 'left'; });
    });
    // ---- v3 → v4 迁移 ----
    // v3 的底部快捷 p6 是「关着 + 只有 3 个待实装按钮」，等于一个空模块。
    // 已经存过 v3 配置的浏览器不会自动吃到新默认值，所以这里手动升级一次；
    // 只在「用户明显没动过它」时升级（内容和开关都还等于 v3 默认）。
    if (Number(s.schemaVersion) < 4) {
        ['desktop', 'mobile'].forEach(dev => {
            const cur = s.devices[dev];
            if (!cur || !Array.isArray(cur.modules)) return;
            const p6 = cur.modules.find(m => m.id === 'p6');
            const untouched = p6 && p6.on === false
                && JSON.stringify(p6.rows) === JSON.stringify([['recent', 'favs', 'random']]);
            if (!untouched) return;
            const def = defaultLayout(dev).modules.find(m => m.id === 'p6');
            if (!def) return;
            p6.rows = def.rows.map(r => r.slice());
            p6.on = def.on;
            p6.align = def.align;
            log('已把底部快捷升级成 v4 默认（居中 + 4 个按钮）');
        });
    }
    if (s.schemaVersion !== SCHEMA_VERSION) s.schemaVersion = SCHEMA_VERSION;
    return s;
}
function save() { try { getContext()?.saveSettingsDebounced?.(); } catch (e) { warn('保存失败', e); } }

function activeDevice() { return isMobileDevice() ? 'mobile' : 'desktop'; }
function layoutOf(s, dev) { return s.devices[dev || activeDevice()]; }

/* ==========================================================================
   DOM 基建：分区容器 + 模块容器
   ========================================================================== */
/** 我们创建的节点：id/class → element */
const zoneEls = new Map();     // zoneId → element
const modEls = new Map();      // moduleId → { root, rows:[element] }
/** 搬动前的父容器快照：parent → children 顺序（用于精确还原） */
const snapshots = new Map();
/** 记录每个被搬过的按钮：btnId → { selector } */
const claimed = new Set();
/**
 * 按按钮 id 缓存元素引用。
 * 为什么必须有它：像 `#rm_print_characters_pagination .paginationjs` 这种后代选择器，
 * 元素一旦被我们搬走就不再匹配了 —— 缓存能让我们继续找到它；
 * 而如果酒馆把它重建了（旧节点断开），缓存失效 → 回退到选择器查询 → 找到新节点。
 * 这一条同时解决了「搬家后选择器失效」和「重绘后重新认领」。
 */
const elCache = new Map();
let boxOpen = false;
let renaming = null;
let drag = null;

/** 我们临时隐藏过的元素（备选池里的按钮要从面板上消失） */
const hideStyle = new Map();

function takeDisplay(el) {
    if (!hideStyle.has(el)) {
        hideStyle.set(el, {
            v: el.style.getPropertyValue('display'),
            p: el.style.getPropertyPriority('display'),
        });
    }
}
function restoreDisplay(el) {
    const rec = hideStyle.get(el);
    if (!rec) return;
    if (rec.v) el.style.setProperty('display', rec.v, rec.p);
    else el.style.removeProperty('display');
    hideStyle.delete(el);
}

/** 这个节点是不是我们自己造出来的？（我们的类名一律 ssp- 打头） */
function isOurs(node) {
    if (!node || !node.className) return false;
    return String(node.className).split(/\s+/).some(c => c.indexOf('ssp-') === 0);
}

/**
 * 记下某个容器「原本」的子节点顺序。
 * ⚠️ 绝不给自己造的节点拍快照 —— 那会把槽位当成原始父节点，
 *    还原时又把按钮塞回槽位（v0.3 的还原失灵就是这么来的）。
 */
function takeSnapshot(parent) {
    if (!parent || isOurs(parent)) return;
    if (!snapshots.has(parent)) snapshots.set(parent, Array.from(parent.children));
}

/** 这两个是不是「同一个按钮」（同 id，或同类名） */
function sameIdentity(a, b) {
    if (!a || !b || a === b) return false;
    if (a.id && b.id) return a.id === b.id;
    if (a.id || b.id) return false;
    return String(a.className || '').trim() === String(b.className || '').trim();
}

/** 找出某个元素的原始父容器（按快照反查） */
function originalParentOf(el) {
    for (const [parent, order] of snapshots) {
        if (order.some(x => x === el || sameIdentity(x, el))) return parent;
    }
    return null;
}

/**
 * 酒馆把按钮重画了（旧的成了断链节点）时，在我们槽位里找到那个「新的同款」。
 * 只在我们自己的槽位里找 —— 绝不会误抓酒馆别处的节点。
 */
function findLiveEquivalent(stale) {
    if (!stale || (!stale.id && !stale.className)) return null;
    for (const rec of modEls.values()) {
        for (const slot of rec.rows) {
            const hit = Array.from(slot.children).find(c => sameIdentity(c, stale));
            if (hit) return hit;
        }
    }
    return null;
}

/** 找到按钮对应的原生元素：先看缓存，缓存断了才重新查询。
    ⚠️ rebuilt（酒馆每次重画都会重建的那种，比如**分页**、标签筛选）不能只信缓存 ——
       我们搬进模块的那个旧副本**一直是 connected 的**，而酒馆已经在原生位置建好了新的：
         · 继续用旧的 → 分页看着在、点不动（模块里那个是死的）
         · 新旧同时存在 → 面板上出现两排一样的分页
       ⚠️ 还有个坑：旧副本被搬走后，`b.native` 那个选择器（带原生父容器的）
       **匹配不到它了** —— 所以清理不能只遍历"选择器匹配到的"，必须显式摘掉缓存里那一个。 */
function resolveNative(b) {
    if (!b || !b.native) return null;
    const cached = elCache.get(b.id);
    if (b.rebuilt) {
        const fresh = query(b.native);                       // 酒馆在原地新建的那个
        const drop = el => { if (el && el !== fresh && el.parentElement && typeof el.remove === 'function') el.remove(); };
        if (fresh && fresh !== cached) {
            drop(cached);                                    // 先摘掉我们搬走的旧副本
            queryAll(b.native).forEach(drop);                // 再清掉可能残留的其它副本
            elCache.set(b.id, fresh);
            return fresh;
        }
        if (fresh) { elCache.set(b.id, fresh); return fresh; }
        /* 酒馆还没重建 → 继续用我们搬过来的那个 */
        if (cached && cached.isConnected !== false) return cached;
        return null;
    }
    if (cached && cached.isConnected !== false) return cached;
    const el = query(b.native);
    if (el) elCache.set(b.id, el);
    return el;
}

function ensureZoneEls() {
    ZONES.forEach(z => {
        let el = document.getElementById(ZONE_PREFIX + z.id);
        if (!el) {
            const anchor = query(z.anchor);
            if (!anchor) return;
            takeSnapshot(anchor);
            el = document.createElement('div');
            el.id = ZONE_PREFIX + z.id;
            // ssp-live：这是「使用态」的真分区（装配界面里的 .ssp-zone 是另一回事），
            // 样式上必须是零装饰 —— 面板要和原版连成一片。
            el.className = 'ssp-zone ssp-live';
            if (z.where === 'prepend') anchor.prepend ? anchor.prepend(el) : anchor.insertBefore(el, anchor.firstChild);
            else anchor.append(el);
            zoneEls.set(z.id, el);
        } else zoneEls.set(z.id, el);
    });
}

/** 让每个模块都有一个容器 + 每层一个 slot（幂等） */
function ensureModuleEls(layout) {
    const wanted = new Set([].concat(...ZONE_IDS.map(z => layout.zones[z] || [])));
    // 删掉配置里没有的
    Array.from(modEls.keys()).forEach(id => {
        if (!wanted.has(id)) {
            const rec = modEls.get(id);
            // ⚠️ 先把槽位里的原生按钮送回它们原来的家，再拆容器 ——
            //    否则按钮会跟着容器一起被摘掉（连窝端）。
            rec.rows.forEach(row => Array.from(row.children).forEach(el => {
                const home = originalParentOf(el);
                if (home && home.isConnected !== false) home.append(el);
            }));
            rec.root.remove();
            modEls.delete(id);
        }
    });
    layout.modules.forEach(m => {
        if (!wanted.has(m.id)) return;
        let rec = modEls.get(m.id);
        if (!rec) {
            const root = document.createElement('div');
            root.className = 'ssp-mod ssp-live';       // ssp-live = 使用态容器，零装饰
            root.dataset.sspMod = m.id;
            rec = { root, rows: [] };
            modEls.set(m.id, rec);
        }
        // 补齐层
        while (rec.rows.length < m.rows.length) {
            const row = document.createElement('div');
            row.className = 'ssp-row';
            rec.root.append(row);
            rec.rows.push(row);
        }
        while (rec.rows.length > m.rows.length) {
            const row = rec.rows.pop();
            /* ⚠️ 拆层之前必须先把这一层里的原生按钮送回老家 ——
               否则它们跟着层一起被 remove，从 DOM 上彻底消失，
               resolveNative 再也查不到 → 按钮"莫名其妙没了"，
               接着该模块判定为空 → 连模块也一起 display:none（2 层改 1 层时必踩）。 */
            Array.from(row.children).forEach(el => {
                const home = originalParentOf(el);
                if (home && home.isConnected !== false) home.append(el);
            });
            row.remove();
        }
    });
}

/** 把模块容器按分区顺序摆好（append 会移动已有节点，所以幂等） */
/**
 * 自愈：**一个按钮只能出现在一个模块里**。
 * 一个按钮只有一个原生 DOM，如果配置里把它放进了两个模块，apply() 每次都会把它
 * 从一个模块搬到另一个 —— 表现就是「一会儿找不到、一会儿又重复出现」（分页那次就是这么翻车的）。
 * 这里保留第一次出现的位置，后面的删掉；有改动就落盘，只修一次。
 */
function normalizeLayout(L) {
    if (!L || !Array.isArray(L.modules)) return 0;
    const seen = new Set();
    let dropped = 0;
    const kept = [];
    L.modules.forEach(m => {
        if (!m || !Array.isArray(m.rows)) return;
        m.rows = m.rows.map(row => (Array.isArray(row) ? row : []).filter(id => {
            if (!id) return false;
            if (seen.has(id)) { dropped += 1; return false; }
            seen.add(id);
            return true;
        }));
        if (!m.rows.length) m.rows = [[]];
        kept.push(m);
    });
    if (dropped) {
        L.modules = kept;
        warn('布局里有', dropped, '个按钮重复出现在多个模块里，已自动去重（保留第一次出现的位置）');
    }
    return dropped;
}

function placeModules(layout) {
    ZONE_IDS.forEach(z => {
        const zoneEl = zoneEls.get(z);
        if (!zoneEl) return;
        (layout.zones[z] || []).forEach(id => {
            const rec = modEls.get(id);
            if (rec) zoneEl.append(rec.root);      // 已在该区里也会移到末尾 —— 顺序由此确定
        });
    });
}

/* ==========================================================================
   核心：把原生元素搬进 slot
   ========================================================================== */
function syncSlot(slot, els) {
    const cur = Array.from(slot.children);
    if (cur.length === els.length && cur.every((c, i) => c === els[i])) return false;
    els.forEach(el => slot.append(el));            // 顺序 = els 顺序，幂等
    return true;
}

/**
 * 让「配置」变成现实。
 * 全程幂等：找不到的元素跳过；已经就位的什么都不做。
 */
function apply() {
    const s = getSettings();
    if (!s.enabled) { restoreAll(); return { moved: 0, hidden: 0, missing: [] }; }
    const dev = activeDevice();
    const layout = layoutOf(s, dev);
    /* 去重：同一个按钮被放进多个模块的话，先自愈（并落盘），不然它会来回跳 */
    if (normalizeLayout(layout)) save();

    ensureZoneEls();
    ensureModuleEls(layout);
    ensureNewBtnEls();
    placeModules(layout);

    let moved = 0, hidden = 0;
    const missing = [];
    const placed = new Set();

    layout.modules.forEach(m => {
        const rec = modEls.get(m.id);
        if (!rec) return;
        let any = false;                     // 这一模块里有没有真的放上去的东西
        m.rows.forEach((ids, r) => {
            const slot = rec.rows[r];
            if (!slot) return;
            // 对齐：直接写在行上（inline 优先于 CSS 的默认 flex-start）
            slot.style.justifyContent = ALIGN_CSS[m.align] || ALIGN_CSS.left;
            const els = [];
            ids.forEach(id => {
                const b = BUTTONS.find(x => x.id === id);
                if (!b) return;
                if (!b.native && !b.made) return;            // B 组里还没实装的：跳过
                placed.add(id);
                const el = b.native ? resolveNative(b) : (newEls.get(b.id) || null);
                if (!el) { if (b.native) missing.push(id); return; }
                if (el.parentElement !== slot) { takeSnapshot(el.parentElement); claimed.add(id); }
                els.push(el);
            });
            if (syncSlot(slot, els)) moved += els.length;
            if (els.length) any = true;
        });
        // 关掉的、或者里面全是「待实装」按钮的模块 → 不占地方（否则面板上会出现空框）
        const show = Boolean(m.on && any);
        rec.root.style.display = show ? '' : 'none';
        if (!show) hidden += 1;
    });

    // 分区里一个模块都没显示 → 整个分区也收起来
    // （底部栏是真有底色和 sticky 的，不收起的话会留一条空条）
    ZONE_IDS.forEach(z => {
        const zEl = zoneEls.get(z);
        if (!zEl) return;
        const anyShown = (layout.zones[z] || []).some(id => {
            const rec = modEls.get(id);
            return rec && rec.root.style.display !== 'none';
        });
        zEl.style.display = anyShown ? '' : 'none';
    });

    // 没被放进任何模块的原生按钮 → 从面板上隐藏（「备选池」= 不在面板上）
    // 默认布局把所有原生按钮都放进模块了，所以装完不会凭空少东西。
    BUTTONS.forEach(b => {
        if (!b.native && !b.made) return;
        const el = b.native ? resolveNative(b) : (newEls.get(b.id) || null);
        if (!el) return;
        if (placed.has(b.id)) { restoreDisplay(el); return; }
        takeDisplay(el);
        el.style.setProperty('display', 'none', 'important');
    });

    return { moved, hidden, missing, placed: Array.from(placed) };
}

/* ==========================================================================
   精确还原
   ========================================================================== */
function restoreAll() {
    // 1) 按钮按快照顺序 append 回原父容器（append 会把已有节点移到末尾 → 顺序精确复原）
    Array.from(snapshots.entries()).forEach(([parent, order]) => {
        if (!parent || parent.isConnected === false || isOurs(parent)) return;
        order.forEach(el => {
            if (!el) return;
            if (el.isConnected !== false) { parent.append(el); return; }
            // 断链了 → 两种情况：酒馆重画过它（换新的还回去），
            // 或者它只是被我们连窝端掉了（把老的那个接回来）
            const live = findLiveEquivalent(el);
            parent.append(live || el);
        });
    });
    // ⚠️ 快照【故意不清空】：关了再开也要能还原回原位。
    //    清了的话，第二次「关掉总开关」就找不回原始位置了。

    // 2) 撤销我们加过的临时隐藏
    Array.from(hideStyle.keys()).forEach(restoreDisplay);
    hideStyle.clear();

    // 3) 拿掉我们自己造的所有节点
    newEls.forEach(el => el.remove());            // 纯新增按钮（重建时再造）
    newEls.clear();
    restoreDetailHeader();                       // 角色详情页版头也还原
    restoreCardStyle();                          // 角色卡样式 + 高清头像也一起撤掉
    setSortMode(false);                          // 退出拖拽排序模式
    modEls.forEach(rec => rec.root.remove());
    modEls.clear();
    zoneEls.forEach(el => el.remove());
    zoneEls.clear();
    const mount = document.getElementById(MOUNT_ID);
    if (mount) mount.remove();
    boxOpen = false;
    renaming = null;
}

/* ==========================================================================
   装配界面（内化在面板里的方框）
   ========================================================================== */
function editorChipHTML(id, multi) {
    const b = BUTTONS.find(x => x.id === id);
    if (!b) return '';
    const miss = b.native && !query(b.native);
    const tools = (multi ? `<i class="ssp-mini fa-solid fa-arrows-up-down" data-ssp-torow="${b.id}" title="换到另一层"></i>` : '')
        + `<i class="ssp-mini fa-solid fa-xmark" data-ssp-remove="${b.id}" title="拿掉（回到备选池）"></i>`;
    const badge = !b.isNew ? '' : (b.made ? '<span class="ssp-badge made">新增</span>' : '<span class="ssp-badge todo">v0.4</span>');
    const tip = b.native ? ' → ' + esc(b.native)
        : (b.made ? '（本插件新增：' + esc(b.hint || b.name) + '）' : '（酒馆原生没有这个按钮，v0.4 才实装）');
    return `<span class="ssp-chip${b.form === 'wide' ? ' wide' : ''}${miss ? ' missing' : ''}${b.isNew ? ' new' : ''}" data-ssp-btn="${b.id}"
        draggable="true" title="${esc(b.name)}${tip}${b.rebuilt ? '（酒馆会重画它）' : ''}">
        <i class="fa-solid ${b.icon}"></i><span class="ssp-cname">${esc(b.name)}</span>${badge}${tools}</span>`;
}

function editorModuleHTML(m, layout, zoneId) {
    const multi = m.rows.length > 1;
    const align = ALIGNS.includes(m.align) ? m.align : 'left';
    const alignHTML = `<span class="ssp-align" title="模块里的按钮怎么摆">
        <i data-ssp-align="${m.id}:left" class="${align === 'left' ? 'on' : ''}" title="靠左">⇤</i>
        <i data-ssp-align="${m.id}:center" class="${align === 'center' ? 'on' : ''}" title="居中">↔</i>
        <i data-ssp-align="${m.id}:right" class="${align === 'right' ? 'on' : ''}" title="靠右">⇥</i></span>`;
    const rows = m.rows.map((ids, r) => `<div class="ssp-row${multi ? ' multi' : ''}" data-ssp-slot="${m.id}:${r}">
        ${multi ? `<span class="ssp-layertag">${r === 0 ? '上层' : '下层'}</span>` : ''}
        <div class="ssp-slot" style="justify-content:${ALIGN_CSS[align]}">${ids.length ? ids.map(id => editorChipHTML(id, multi)).join('')
            : '<span class="ssp-empty">这一层是空的</span>'}</div></div>`).join('');
    const list = layout.zones[zoneId] || [];
    const i = list.indexOf(m.id);
    const hasReal = m.rows.some(r => r.some(id => { const b = BUTTONS.find(x => x.id === id); return Boolean(b && (b.native || b.made)); }));
    const stateTag = !hasReal ? '<span class="ssp-tag new">v0.4 待实装</span>'
        : (m.on ? '' : '<span class="ssp-tag">已隐藏</span>');
    return `<div class="ssp-mod${m.on ? '' : ' off'}" data-ssp-mod="${m.id}">
        <div class="ssp-mhead">
            <i class="ssp-handle fa-solid fa-grip-vertical" title="拖动换位置（可拖到别的分区）"></i>
            ${renaming === m.id
                ? `<input class="ssp-rename" data-ssp-rename="${m.id}" value="${esc(m.name)}">`
                : `<span class="ssp-mname" data-ssp-startrename="${m.id}" title="点一下改名字">${esc(m.name)}</span>`}
            ${stateTag}
            <span class="ssp-layers"><i data-ssp-layers="${m.id}:1" class="${multi ? '' : 'on'}">1层</i><i data-ssp-layers="${m.id}:2" class="${multi ? 'on' : ''}">2层</i></span>
            ${alignHTML}
            <label class="ssp-sw" title="显示 / 隐藏这个模块"><input type="checkbox" data-ssp-on="${m.id}" ${m.on ? 'checked' : ''}><span class="ssp-track"><span class="ssp-knob"></span></span></label>
            <span class="ssp-mv">
                <i class="fa-solid fa-chevron-up" data-ssp-mup="${m.id}" ${i <= 0 ? 'disabled' : ''}></i>
                <i class="fa-solid fa-chevron-down" data-ssp-mdown="${m.id}" ${i >= list.length - 1 ? 'disabled' : ''}></i>
                <i class="fa-solid fa-arrow-right-arrow-left" data-ssp-mzone="${m.id}" title="移到另一个分区"></i>
                <i class="fa-solid fa-trash ssp-del" data-ssp-delmod="${m.id}" title="删除模块（按钮回备选池）"></i>
            </span>
        </div>${rows}</div>`;
}

function poolHTML(layout) {
    const used = new Set(layout.modules.flatMap(m => m.rows.flat()));
    const ids = BUTTONS.filter(b => !used.has(b.id)).map(b => b.id);
    return `<div class="ssp-pool" data-ssp-pool="1"><div class="ssp-plabel">备选按钮（${ids.length}）· 拖进任意一层</div>
        <div class="ssp-slot">${ids.length ? ids.map(id => editorChipHTML(id, false).replace(/<i class="ssp-mini[^>]*><\/i>/g, '')).join('')
            : '<span class="ssp-empty">按钮都用上了</span>'}</div></div>`;
}

function editorHTML() {
    const s = getSettings();
    const layout = layoutOf(s, activeDevice());
    const zones = [ZONES[0], LIST_ZONE, ZONES[1]].map(z => {
        if (z.locked) return `<div class="ssp-zone locked"><div class="ssp-zhead"><b>${z.name}</b><code>${esc(z.desc)}</code></div></div>`;
        const ids = layout.zones[z.id] || [];
        const on = ids.filter(id => (layout.modules.find(m => m.id === id) || {}).on).length;
        const mods = ids.map(id => {
            const m = layout.modules.find(x => x.id === id);
            return m ? editorModuleHTML(m, layout, z.id) : '';
        }).join('');
        return `<div class="ssp-zone" data-ssp-zone="${z.id}"><div class="ssp-zhead"><b>${z.name}</b><code>${esc(z.desc)}</code>
            <span class="ssp-cnt">${on}/${ids.length} 开</span></div>
            ${mods}<div class="ssp-addmod" data-ssp-newmod="${z.id}"><i class="fa-solid fa-plus"></i> 新建模块</div></div>`;
    }).join('');
    return `<div class="ssp-boxhead"><b>装配态</b><span>勾选=显隐 ▲▼=顺序 点名字=改名</span><span class="ssp-sp"></span>
        <button class="ssp-btn" data-ssp-reset="1">恢复原版</button>
        <button class="ssp-btn" data-ssp-close="1">✓ 完成</button></div>
        <div class="ssp-boxbody">${zones}${poolHTML(layout)}
        <div class="ssp-hint">当前设备：<b>${activeDevice() === 'mobile' ? '手机' : '桌面'}</b>（桌面/手机是两套独立布局）<br>
        拖 <b>≡</b> 换模块（可跨分区）· 拖<b>按钮</b>或按 <b>⇅</b> 换层 · <b>1层/2层</b> 改层数 · <b>🗑</b> 删模块</div></div>`;
}

function ensureMount() {
    let mount = document.getElementById(MOUNT_ID);
    if (mount) return mount;
    const host = query('#charListFixedTop') || query('#rm_characters_block') || query('#right-nav-panel');
    if (!host) return null;
    mount = document.createElement('div');
    mount.id = MOUNT_ID;
    mount.className = 'ssp-mount';
    mount.addEventListener('click', onMountClick);
    mount.addEventListener('pointerdown', onMountPointerDown);   // 触摸端拖拽（HTML5 拖放在手机上不触发）
    guardTouchScroll();
    mount.addEventListener('change', onMountChange);
    mount.addEventListener('keydown', onMountKey);
    mount.addEventListener('dragstart', onMountDragStart);
    mount.addEventListener('dragover', onMountDragOver);
    mount.addEventListener('drop', onMountDrop);
    mount.addEventListener('dragend', onMountDragEnd);
    host.append(mount);
    renderMount();
    return mount;
}

function renderMount() {
    const mount = document.getElementById(MOUNT_ID);
    if (!mount) return;
    const scroller = mount.querySelector('.ssp-boxbody');
    const keep = scroller ? scroller.scrollTop : 0;
    mount.innerHTML = `<div class="ssp-toggle" data-ssp-togglebox="1" id="${TOGGLE_ID}">
        <i class="fa-solid fa-table-columns"></i><span class="ssp-tname">装配面板</span><span class="ssp-sp"></span>
        <span class="ssp-tstate">${boxOpen ? '收起 ▴' : '展开 ▾'}</span></div>`
        + (boxOpen ? `<div class="ssp-box" id="${BOX_ID}">${editorHTML()}</div>` : '');
    const next = mount.querySelector('.ssp-boxbody');
    if (next) next.scrollTop = keep;
    markEditing();
}

/**
 * 装配态：给「使用态」的分区/模块描一圈虚线，方便看清哪几块是一组。
 * 用 outline 而不是 border —— outline 不参与布局，
 * 所以开/关装配面板时面板本身不会跳动；收起后一点痕迹都不留。
 */
function markEditing() {
    zoneEls.forEach(el => {
        if (boxOpen) el.classList.add('ssp-editing');
        else el.classList.remove('ssp-editing');
    });
}

/* ==========================================================================
   装配操作
   ========================================================================== */
function currentLayout() { return layoutOf(getSettings(), activeDevice()); }
function findModule(id) { return currentLayout().modules.find(m => m.id === id); }
function zoneOfModule(id) { return ZONE_IDS.find(z => (currentLayout().zones[z] || []).includes(id)) || null; }
function locateButton(id) {
    const L = currentLayout();
    for (const m of L.modules) for (let r = 0; r < m.rows.length; r++) {
        const i = m.rows[r].indexOf(id);
        if (i >= 0) return { m, r, i };
    }
    return null;
}
function commit() { save(); apply(); renderMount(); }

/** 改某个模块的对齐方式（左/中/右） */
function setAlign(moduleId, align) {
    const m = findModule(moduleId);
    if (!m || !ALIGNS.includes(align)) return null;
    m.align = align;
    return m;
}

function putButton(btnId, moduleId, row, index) {
    const L = currentLayout();
    if (!BUTTONS.some(b => b.id === btnId)) return false;
    const loc = locateButton(btnId);
    if (loc) loc.m.rows[loc.r].splice(loc.i, 1);
    const m = L.modules.find(x => x.id === moduleId);
    if (!m) return false;
    const r = (typeof row === 'number' && row >= 0 && row < m.rows.length) ? row : m.rows.length - 1;
    const at = (typeof index === 'number' && index >= 0 && index <= m.rows[r].length) ? index : m.rows[r].length;
    m.rows[r].splice(at, 0, btnId);
    return true;
}
function toggleRow(btnId) {
    const loc = locateButton(btnId);
    if (!loc || loc.m.rows.length < 2) return false;
    loc.m.rows[loc.r].splice(loc.i, 1);
    loc.m.rows[loc.r === 0 ? 1 : 0].push(btnId);
    return true;
}
function setLayers(moduleId, n) {
    const m = findModule(moduleId);
    if (!m) return false;
    if (n === 2 && m.rows.length === 1) m.rows.push([]);
    if (n === 1 && m.rows.length > 1) m.rows = [m.rows.flat()];
    return true;
}
function addModule(zoneId, name) {
    const L = currentLayout();
    if (!L.zones[zoneId]) return null;
    const id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
    const m = { id, name: name || ('新模块 ' + (L.modules.length + 1)), on: true, rows: [[]] };
    L.modules.push(m);
    L.zones[zoneId].push(id);
    return m;
}
function delModule(moduleId) {
    const L = currentLayout();
    const z = zoneOfModule(moduleId);
    if (z) L.zones[z] = L.zones[z].filter(x => x !== moduleId);
    L.modules = L.modules.filter(m => m.id !== moduleId);
    if (renaming === moduleId) renaming = null;
    return true;
}
function renameModule(moduleId, name) {
    const m = findModule(moduleId);
    if (!m) return false;
    const clean = String(name || '').trim();
    if (clean) m.name = clean.slice(0, 24);
    return true;
}
function moveModule(moduleId, delta) {
    const z = zoneOfModule(moduleId);
    if (!z) return false;
    const arr = currentLayout().zones[z];
    const i = arr.indexOf(moduleId), j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return true;
}
function moveModuleToOtherZone(moduleId) {
    const from = zoneOfModule(moduleId);
    if (!from) return false;
    const to = ZONE_IDS.find(z => z !== from);
    const L = currentLayout();
    L.zones[from] = L.zones[from].filter(x => x !== moduleId);
    L.zones[to].push(moduleId);
    return true;
}

/* ==========================================================================
   事件
   ========================================================================== */
function onMountChange(e) {
    const on = e.target?.dataset?.sspOn;
    if (on) { const m = findModule(on); if (m) { m.on = e.target.checked; commit(); } return; }
    const rn = e.target?.dataset?.sspRename;
    if (rn) { renameModule(rn, e.target.value); renaming = null; commit(); }
}
function onMountKey(e) {
    if (e.key !== 'Enter') return;
    const rn = e.target?.dataset?.sspRename;
    if (rn) { renameModule(rn, e.target.value); renaming = null; commit(); }
}
function onMountClick(e) {
    const g = sel => e.target.closest?.(sel);
    /* 触摸端：点选搬运（长按拖拽之外的另一条路，更好按） */
    if (pointerKind !== 'mouse') {
        const chip = g('.ssp-chip[data-ssp-btn]');
        const onCtl = g('.ssp-mini') || g('.ssp-mv') || g('.ssp-layers') || g('.ssp-align') ||
            g('.ssp-sw') || g('.ssp-handle') || g('.ssp-mhead') || g('[data-ssp-rename]');
        if (chip && !g('.ssp-mini')) { tapSelect(chip.dataset.sspBtn); return; }
        if (tapSel && !onCtl && tapDropTo(e.target)) return;
    }
    if (g('[data-ssp-togglebox]')) { boxOpen = !boxOpen; renaming = null; renderMount(); return; }
    if (g('[data-ssp-close]')) { boxOpen = false; renderMount(); return; }
    if (g('[data-ssp-reset]')) {
        const s = getSettings();
        s.devices[activeDevice()] = defaultLayout(activeDevice());
        commit(); toast('已恢复成酒馆原版', 'info'); return;
    }
    const rm = g('[data-ssp-remove]');
    if (rm) { const l = locateButton(rm.dataset.sspRemove); if (l) { l.m.rows[l.r].splice(l.i, 1); commit(); } return; }
    const tr = g('[data-ssp-torow]');
    if (tr) { toggleRow(tr.dataset.sspTorow); commit(); return; }
    const ly = g('[data-ssp-layers]');
    if (ly) { const p = ly.dataset.sspLayers.split(':'); setLayers(p[0], Number(p[1])); commit(); return; }
    const al = g('[data-ssp-align]');
    if (al) {
        const p = String(al.dataset.sspAlign).split(':');
        if (setAlign(p[0], p[1])) commit();
        return;
    }
    const dz = g('[data-ssp-delmod]');
    if (dz) { delModule(dz.dataset.sspDelmod); commit(); return; }
    const nw = g('[data-ssp-newmod]');
    if (nw) { const m = addModule(nw.dataset.sspNewmod); if (m) renaming = m.id; commit(); return; }
    const sr = g('[data-ssp-startrename]');
    if (sr) { renaming = sr.dataset.sspStartrename; renderMount(); return; }
    const mu = g('[data-ssp-mup]'), md = g('[data-ssp-mdown]');
    if (mu) { moveModule(mu.dataset.sspMup, -1); commit(); return; }
    if (md) { moveModule(md.dataset.sspMdown, 1); commit(); return; }
    const mz = g('[data-ssp-mzone]');
    if (mz) { moveModuleToOtherZone(mz.dataset.sspMzone); commit(); return; }
    const pc = g('.ssp-pool [data-ssp-btn]');
    if (pc) {
        const L = currentLayout();
        const first = (L.zones.head || [])[0] || (L.zones.foot || [])[0];
        if (first) { putButton(pc.dataset.sspBtn, first); commit(); }
    }
}

/* 拖拽 */
function onMountDragStart(e) {
    const chip = e.target.closest?.('.ssp-chip[data-ssp-btn]');
    if (chip) {
        drag = { kind: 'button', id: chip.dataset.sspBtn };
        chip.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', drag.id); } catch (_) { }
        return;
    }
    const head = e.target.closest?.('.ssp-handle');
    const mod = head?.closest?.('.ssp-mod[data-ssp-mod]');
    if (mod) {
        drag = { kind: 'module', id: mod.dataset.sspMod };
        mod.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', drag.id); } catch (_) { }
    }
}
function clearMarks() {
    document.querySelectorAll('.ssp-dragover,.dragging,.drop-t,.drop-b')
        .forEach(el => el.classList.remove('ssp-dragover', 'dragging', 'drop-t', 'drop-b'));
}
function onMountDragEnd() { clearMarks(); drag = null; }
function onMountDragOver(e) {
    if (!drag) return;
    clearMarks();
    if (drag.kind === 'button') {
        const pool = e.target.closest?.('[data-ssp-pool]');
        if (pool) { e.preventDefault(); pool.classList.add('ssp-dragover'); return; }
        const slot = e.target.closest?.('[data-ssp-slot]');
        if (slot) { e.preventDefault(); slot.classList.add('ssp-dragover'); }
        return;
    }
    const mod = e.target.closest?.('.ssp-mod[data-ssp-mod]');
    if (mod && mod.dataset.sspMod !== drag.id) {
        e.preventDefault();
        const r = mod.getBoundingClientRect();
        mod.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-t' : 'drop-b');
        return;
    }
    const zone = e.target.closest?.('[data-ssp-zone]');
    if (zone) { e.preventDefault(); zone.classList.add('ssp-dragover'); }
}
function onMountDrop(e) {
    if (!drag) return;
    e.preventDefault();
    if (drag.kind === 'button') {
        const id = drag.id;
        const pool = e.target.closest?.('[data-ssp-pool]');
        if (pool) { const l = locateButton(id); if (l) { l.m.rows[l.r].splice(l.i, 1); commit(); } drag = null; return; }
        const slot = e.target.closest?.('[data-ssp-slot]');
        if (slot) {
            const p = slot.dataset.sspSlot.split(':');
            const L = currentLayout();
            const m = L.modules.find(x => x.id === p[0]);
            let index = m ? m.rows[Number(p[1])].length : 0;
            const chip = e.target.closest?.('.ssp-chip[data-ssp-btn]');
            if (m && chip && chip.dataset.sspBtn !== id) {
                const at = m.rows[Number(p[1])].indexOf(chip.dataset.sspBtn);
                if (at >= 0) {
                    const r = chip.getBoundingClientRect();
                    index = (e.clientX < r.left + r.width / 2) ? at : at + 1;
                }
            }
            drag = null;
            putButton(id, p[0], Number(p[1]), index);
            commit(); return;
        }
        drag = null; return;
    }
    const id = drag.id;
    const zoneEl = e.target.closest?.('[data-ssp-zone]');
    if (!zoneEl) { drag = null; return; }
    const to = zoneEl.dataset.sspZone;
    const from = zoneOfModule(id);
    const L = currentLayout();
    if (!from || !to || !L.zones[to]) { drag = null; return; }
    let insertAt;
    const mod = e.target.closest?.('.ssp-mod[data-ssp-mod]');
    if (mod && mod.dataset.sspMod !== id) {
        const r = mod.getBoundingClientRect();
        const after = e.clientY >= r.top + r.height / 2;
        insertAt = L.zones[to].indexOf(mod.dataset.sspMod) + (after ? 1 : 0);
    } else insertAt = L.zones[to].length;
    L.zones[from] = L.zones[from].filter(x => x !== id);
    L.zones[to].splice(Math.max(0, Math.min(insertAt, L.zones[to].length)), 0, id);
    drag = null;
    commit();
}

/* ==========================================================================
   触摸端交互（手机 / 平板）
   --------------------------------------------------------------------------
   ⚠️ HTML5 拖放（dragstart/drop）在触摸屏上根本不触发 —— 手机上原来没法把按钮
      从一个模块拖到另一个模块。这里用 pointer 事件自己实现一套：
        · 长按 250ms → 开始拖（不然手指一碰就抢走滚动）
        · 拖动时有跟随手指的影子，落点用 elementFromPoint 找
        · 落点解析直接复用 onMountDrop，规则和桌面完全一致
      另外给一个更省事的「点选搬运」：点一下按钮选中，再点目标模块的某一层即可。
   ========================================================================== */
let touchDrag = null;              // { kind, id, ghost, target }
let touchTimer = null;
let pointerKind = 'mouse';         // 最近一次按下是什么设备
const TOUCH_HOLD_MS = 250;         // 长按多久算拖拽
const TOUCH_SLOP = 8;              // 手指动超过这个距离就当作滚动，取消长按

function fakeDropEvent(x, y) {
    const el = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    return { target: el || document.body, clientX: x, clientY: y, preventDefault() { } };
}
function ghostFor(el, text) {
    const g = document.createElement('div');
    g.className = 'ssp-ghost';
    g.textContent = text || el?.textContent?.trim()?.slice(0, 12) || '移动';
    document.body.appendChild(g);
    return g;
}
function moveGhost(gx, x, y) {
    if (!gx) return;
    const r = gx.getBoundingClientRect ? gx.getBoundingClientRect() : { width: 40, height: 20 };
    gx.style.left = (x - r.width / 2) + 'px';
    gx.style.top = (y - 22) + 'px';
}
/** 真正开始拖（长按到点 / 测试直接调） */
function touchBegin(kind, id, x, y, el) {
    drag = { kind, id };
    touchDrag = { kind, id, ghost: ghostFor(el, kind === 'module' ? el?.textContent : null) };
    try { el?.classList?.add?.('dragging'); } catch (e) { /* 无妨 */ }
    moveGhost(touchDrag.ghost, x, y);
    return touchDrag;
}
function touchMove(x, y) {
    if (!touchDrag) return;
    moveGhost(touchDrag.ghost, x, y);
    onMountDragOver(fakeDropEvent(x, y));
}
function touchEnd(x, y) {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
    if (!touchDrag) return;
    const g = touchDrag.ghost;
    if (g) g.remove();
    touchDrag = null;
    onMountDrop(fakeDropEvent(x, y));   // 落点规则和桌面版共用
    clearMarks();
}
function touchCancel() {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
    if (touchDrag?.ghost) touchDrag.ghost.remove();
    touchDrag = null;
    clearMarks();
    drag = null;
}
/**
 * 手机上的「点选搬运」：点一个按钮选中 → 点目标层 / 备选池就搬过去。
 * 比长按拖拽好按，也不用按住不放。
 */
let tapSel = null;
function tapSelect(id) {
    tapSel = (tapSel === id) ? null : id;
    queryAll('.ssp-chip').forEach(c => c.classList.toggle('tap-sel', c.dataset.sspBtn === tapSel));
    if (tapSel) toast('已选中「' + (BUTTONS.find(b => b.id === tapSel) || {}).name + '」，点目标模块的某一层放下', 'info');
    return tapSel;
}
function tapDropTo(target) {
    if (!tapSel) return false;
    const id = tapSel;
    const pool = target?.closest?.('[data-ssp-pool]');
    const slot = target?.closest?.('[data-ssp-slot]');
    const wasSel = tapSel;
    tapSel = null;
    queryAll('.ssp-chip').forEach(c => c.classList.remove('tap-sel'));
    if (pool) { const l = locateButton(id); if (l) { l.m.rows[l.r].splice(l.i, 1); commit(); } return true; }
    if (slot) {
        const p = slot.dataset.sspSlot.split(':');
        putButton(id, p[0], Number(p[1]), undefined);
        commit();
        return true;
    }
    tapSel = wasSel;                     // 没点到能放的地方，保持选中
    queryAll('.ssp-chip').forEach(c => c.classList.toggle('tap-sel', c.dataset.sspBtn === tapSel));
    return false;
}
function onMountPointerDown(e) {
    pointerKind = e.pointerType || 'mouse';
    if (pointerKind === 'mouse') return;               // 桌面走 HTML5 拖放
    const chip = e.target.closest?.('.ssp-chip[data-ssp-btn]');
    const head = e.target.closest?.('.ssp-handle');
    const mod = head?.closest?.('.ssp-mod[data-ssp-mod]');
    const hit = chip || head;
    if (!hit) return;
    const kind = chip ? 'button' : 'module';
    const id = chip ? chip.dataset.sspBtn : mod?.dataset.sspMod;
    if (!id) return;
    const startX = e.clientX, startY = e.clientY;
    if (touchTimer) clearTimeout(touchTimer);
    touchTimer = globalThis.setTimeout?.(() => {
        touchTimer = null;
        touchBegin(kind, id, startX, startY, chip || mod);
    }, TOUCH_HOLD_MS);
    const onMove = ev => {
        if (touchDrag) { ev.preventDefault?.(); touchMove(ev.clientX, ev.clientY); return; }
        if (Math.abs(ev.clientX - startX) > TOUCH_SLOP || Math.abs(ev.clientY - startY) > TOUCH_SLOP) {
            if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }   // 是在滚动，不是长按
        }
    };
    const onUp = ev => {
        document.removeEventListener?.('pointermove', onMove);
        document.removeEventListener?.('pointerup', onUp);
        document.removeEventListener?.('pointercancel', onUp);
        if (touchDrag) touchEnd(ev.clientX, ev.clientY);
        else if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
    };
    document.addEventListener?.('pointermove', onMove, { passive: false });
    document.addEventListener?.('pointerup', onUp);
    document.addEventListener?.('pointercancel', onUp);
}
/** 拖动过程中别让页面跟着滚（touchmove 非 passive 才能中途拦住） */
function guardTouchScroll() {
    if (guardTouchScroll.done) return;
    guardTouchScroll.done = true;
    document.addEventListener?.('touchmove', ev => {
        if (touchDrag) ev.preventDefault?.();
    }, { passive: false });
}

/** 列表里那行「作者注释」只显示第一行。
    酒馆的 .ch_description 装的是角色卡的 creator_notes（创作者注释），而且自带
    white-space:nowrap —— 整段（含换行）被拼成一长条再打省略号，于是看到的开头是
    「--- **某某人物设定** **姓名：** …」这种。这里按**第一个换行**截断只留第一行，
    完整内容塞进 title，鼠标停上去照样能看全。 */
function trimListCreatorNotes() {
    if (getSettings().listNotesFirstLine === false) return false;
    let n = 0;
    queryAll('#rm_print_characters_block .character_select').forEach(card => {
        const el = card && card.querySelector ? card.querySelector('.ch_description') : null;
        if (!el) return;
        const full = String(el.textContent == null ? '' : el.textContent);
        const nl = full.search(/[\r\n]/);
        if (nl < 0) {                                   // 本来就只有一行 → 不碰它
            if (el.setAttribute && full.trim()) el.setAttribute('title', full.trim());
            return;
        }
        const first = full.slice(0, nl).trim();
        el.textContent = first || full.slice(0, 80).trim();
        if (el.setAttribute) el.setAttribute('title', full.trim());
        n += 1;
    });
    return n > 0;
}

function toast(msg, level = 'info') {
    const fn = globalThis.toastr?.[level];
    if (typeof fn === 'function') fn(msg, '鼠鼠小助手');
    else log(msg);
}

/* ==========================================================================
   设置抽屉（兜底入口）
   ========================================================================== */
function mountDrawer() {
    if (document.getElementById('ssp_drawer')) return true;
    const host = query('#extensions_settings2') || query('#extensions_settings');
    if (!host) return false;
    const wrap = document.createElement('div');
    wrap.id = 'ssp_drawer';
    wrap.className = 'inline-drawer';
    wrap.innerHTML = `<div class="inline-drawer-toggle inline-drawer-header"><b>🐭 鼠鼠小助手</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content">
            <div class="ssp-note">思维链收纳 + 角色面板装配 + 8 种角色卡样式 + 详情页版头 + 导入即更新。
            设置都在下面那个独立的扁平面板里（不用在一堆扩展里翻）。</div>
            <div class="ssp-drawer-row">
            <div class="menu_button" data-ssp-panel-open="1">打开鼠鼠面板</div>
            <label class="checkbox_label"><input type="checkbox" data-ssp-enabled="1" ${getSettings().enabled ? 'checked' : ''}>
            <span>启用（关掉＝立刻还原成原版）</span></label></div></div>`;
wrap.addEventListener('click', ev => {
        if (ev.target.closest && ev.target.closest('[data-ssp-panel-open]')) openSettingsPanel();
    });
    wrap.addEventListener('change', ev => {
        const t2 = ev.target;
        if (!t2 || t2.dataset.sspEnabled === undefined) return;
        const s2 = getSettings();
        s2.enabled = Boolean(t2.checked);
        save();
        if (s2.enabled) { apply(); ensureMount(); } else { restoreAll(); }
        toast(s2.enabled ? '已启用' : '已关闭并还原', 'info');
    });

    host.append(wrap);
    return true;
}

/* 所有设置项的事件逻辑集中在这儿；面板和抽屉共用（root 传谁就绑谁） */
function bindSettings(root) {
    const wrap = root;
        wrap.addEventListener('click', ev => {
            if (ev.target.closest('[data-ssp-open]')) { boxOpen = true; ensureMount(); renderMount(); }
            if (ev.target.closest('[data-ssp-sortmode]')) { setSortMode(!sortMode); return; }
            if (ev.target.closest('[data-ssp-color-reset]')) { setCardColor('songBg', '#4a2b7d', true, wrap); return; }
            if (ev.target.closest('[data-ssp-clearorder]')) { clearCardOrder(); toast('已清空自定义顺序', 'info'); return; }
            if (ev.target.closest('[data-ssp-card-measure]')) {
                const box = wrap.querySelector('[data-ssp-card-out2]');
                if (box) { box.hidden = false; box.textContent = measureCards(); }
            }
            if (ev.target.closest('[data-ssp-restore]')) {
                const s = getSettings();
                s.devices[activeDevice()] = defaultLayout(activeDevice());
                commit(); toast('已恢复成酒馆原版', 'info');
            }
        });
        /* 下拉框 / 复选框 / 文字框：改完立刻生效并落盘 */
        wrap.addEventListener('change', ev => {
            const t = ev.target;
            if (!t || !t.dataset) return;
            const c = cardStyleSettings();
            if (t.dataset.sspUseorder) { getSettings().useCardOrder = Boolean(t.checked); save(); applyCardOrder(); return; }
            if (t.dataset.sspUseorder) { getSettings().useCardOrder = Boolean(t.checked); save(); applyCardOrder(); return; }
            if (t.dataset.sspCardStyle !== undefined) {
                switchCardStyle(t.value);
                save(); applyCardStyle(); refreshCardSection(); return;
            }
            if (t.dataset.sspCardSelect) { c[t.dataset.sspCardSelect] = t.value; save(); applyCardStyle(); return; }
            if (t.dataset.sspDetailStyle) { getSettings().detailStyle = (t.value === 'video' ? 'video' : 'about'); save(); applyDetailHeader(); return; }
            if (t.dataset.sspImportmerge !== undefined) {
                getSettings().importMerge = Boolean(t.checked);
                save();
                if (t.checked) bindImportMerge(); else restoreImportMerge();
                toast(t.checked ? '导入即更新：开' : '导入即更新：已关（酒馆原样）', 'info');
                return;
            }
            if (t.dataset.sspImpsim !== undefined) {
                getSettings().importSimThreshold = Math.min(0.95, Math.max(0.2, Number(t.value) / 100));
                save();
                const out = wrap.querySelector('[data-ssp-impout]');
                if (out) out.textContent = t.value + '%';
                return;
            }
            if (t.dataset.sspOrbon !== undefined) {
            getSettings().orbOn = Boolean(t.checked); save();
            if (t.checked) { orbBuilt = false; mountOrb(); bindOrb(); refreshOrbBadge(); }
            else { const r0 = document.getElementById('ssp_orb_root'); if (r0) r0.remove(); const b0 = document.getElementById('ssp_orb'); if (b0) b0.remove(); orbBuilt = false; closeOrb(); }
            toast(t.checked ? '悬浮球：开' : '悬浮球：关', 'info'); return; }
        if (t.dataset.sspNotesone !== undefined) { getSettings().listNotesFirstLine = Boolean(t.checked); save(); trimListCreatorNotes(); toast(t.checked ? '作者注释：只显示第一行' : '作者注释：整段显示', 'info'); return; }
        if (t.dataset.sspThinkshield !== undefined) { getSettings().thinkShield = Boolean(t.checked); save(); toast(t.checked ? '思维链收纳：开' : '思维链收纳：关', 'info'); return; }
            if (t.dataset.sspThinkload !== undefined) { getSettings().thinkOnChatLoad = Boolean(t.checked); save(); return; }
            if (t.dataset.sspThinktags !== undefined) { getSettings().thinkTags = String(t.value || 'think,thinking,thought'); save(); return; }
            if (t.dataset.sspCardCheck) { c[t.dataset.sspCardCheck] = Boolean(t.checked); save(); applyCardStyle(); return; }
            if (t.dataset.sspCardColor) { setCardColor(t.dataset.sspCardColor, t.dataset.sspColorReset ? '#4a2b7d' : t.value, true); return; }
            if (t.dataset.sspCardText) { c[t.dataset.sspCardText] = t.value; save(); applyCardStyle(); return; }
            if (t.dataset.sspDetailToggle !== undefined) {
                getSettings().detailHeader = Boolean(t.checked);
                save();
                applyDetailHeader();
                toast(t.checked ? '详情页版头：开' : '详情页版头：已还原成原版', 'info');
                return;
            }
            if (!t.dataset.sspEnabled) return;
            const s = getSettings();
            s.enabled = Boolean(t.checked);
            save();
            if (s.enabled) { apply(); ensureMount(); } else { restoreAll(); }
            toast(s.enabled ? '已启用' : '已关闭并还原', 'info');
        });
        /* 滑块：拖动实时生效，松手（change）才写设置，免得刷爆存档；颜色输入同理 */
        wrap.addEventListener('input', ev => {
            const t = ev.target;
            if (t?.dataset?.sspCardColor && !t.dataset.sspColorReset) { setCardColor(t.dataset.sspCardColor, t.value, false, wrap); return; }
            if (t?.dataset?.sspImpsim !== undefined) {
                const out = wrap.querySelector('[data-ssp-impout]');
                if (out) out.textContent = t.value + '%';
                getSettings().importSimThreshold = Math.min(0.95, Math.max(0.2, Number(t.value) / 100));
                return;
            }
            const k = t?.dataset?.sspCardKnob;
            if (!k) return;
            const c = cardStyleSettings();
            c[k] = Number(t.value);
            const out = wrap.querySelector('[data-ssp-card-out="' + k + '"]');
            if (out) out.textContent = t.value + (k === 'fadeStop' || k === 'overlay' ? '%' : 'px');
            applyCardStyle();
        });
        wrap.addEventListener('change', ev => {
            if (ev.target?.dataset?.sspCardKnob) save();
        });
}


/* ==========================================================================
   🐭 鼠鼠面板：扁平化设置面板
   --------------------------------------------------------------------------
   以前所有设置都挤在酒馆「扩展」列表里那个折叠抽屉里 —— 十几个扩展里根本找不到，
   而且一行一个原生 checkbox 确实不好看。现在做成一个独立的扁平面板：
     · 分区卡片 + 发丝分隔线 + 扁平开关 / 滑块 / 输入框，不用渐变、不用高光
     · 颜色全部走酒馆主题变量（--SmartTheme*），你换主题它自动跟着变
     · 入口：扩展列表里那个抽屉中的「打开鼠鼠面板」按钮；Esc 或点背景也能关
   关键：所有设置项的 data-ssp-* 属性和原来**一模一样**，
   所以 bindSettings() 里那一大段逻辑一行都不用改。
   ========================================================================== */
const PANEL_VERSION = '1.23.1';   // 面板上显示的版本号（改 manifest 时记得一起改）
let panelEl = null;

/** 扁平开关（外面套 label，里面是真 checkbox —— 事件逻辑完全复用老的） */
function fsw(attr, on) {
    return `<label class="ssp-sw"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><i></i></label>`;
}

/** 一行：左边标题+小字说明，右边控件 */
function frow(label, desc, ctl) {
    return `<div class="ssp-row"><div class="ssp-lab">${esc(label)}${desc ? `<small>${esc(desc)}</small>` : ''}</div>`
        + `<div class="ssp-ctl">${ctl}</div></div>`;
}

function settingsPanelHTML() {
    const s = getSettings();
    const c = cardStyleSettings();
    const orderCount = (s.cardOrder || []).length;
    const pct = Math.round(importSimThreshold() * 100);

    const sec = (icon, title, inner, note) => `
      <section class="ssp-sec">
        <h4><i class="fa-solid ${icon}"></i>${esc(title)}</h4>
        <div class="ssp-secbody">${inner}${note ? `<div class="ssp-fnote">${note}</div>` : ''}</div>
      </section>`;

    /* —— 面板装配 —— */
    const secBuild = sec('fa-table-cells-large', '面板装配', [
        frow('启用面板工坊', '关掉＝立刻还原成酒馆原版', fsw('data-ssp-enabled="1"', s.enabled)),
        frow('装配面板', '拖拽排布模块与按钮（桌面 / 手机两套布局）',
            '<div class="ssp-pbtn" data-ssp-open="1"><i class="fa-solid fa-up-right-and-down-left-from-center"></i>展开装配面板</div>'),
        frow('恢复原版', '把当前设备的布局还原成酒馆默认',
            '<div class="ssp-pbtn" data-ssp-restore="1"><i class="fa-solid fa-rotate-left"></i>恢复原版</div>'),
    ].join(''));

    /* —— 角色列表排序 —— */
    const secSort = sec('fa-arrow-down-wide-short', '角色列表排序', [
        frow('手动排序', '进入后拖动角色卡即可',
            '<div class="ssp-pbtn" data-ssp-sortmode="1"><i class="fa-solid fa-hand-pointer"></i>进入拖拽排序</div>'),
        frow('清空我的顺序', '只清顺序，不动角色卡',
            '<div class="ssp-pbtn" data-ssp-clearorder="1"><i class="fa-solid fa-eraser"></i>清空</div>'),
        frow('按我的顺序', `自定义顺序里有 ${orderCount} 个角色`, fsw('data-ssp-useorder="1"', s.useCardOrder !== false)),
    ].join(''));

    /* —— 角色卡样式（沿用原来那块渲染器，只是搬进面板）—— */
    const secCard = `<section class="ssp-sec">
        <h4><i class="fa-solid fa-image"></i>角色卡样式</h4>
        <div class="ssp-secbody">
          ${frow('作者注释只显示第一行', '列表里那行是角色卡的「创作者注释」；关掉就整段显示（长文本会被省略号截断）',
              fsw('data-ssp-notesone="1"', s.listNotesFirstLine !== false))}
          <div id="ssp_cardslot">${cardDrawerHTML()}</div>
        </div></section>`;

    /* —— 详情页版头 —— */
    const secDetail = sec('fa-id-card', '角色详情页版头', [
        frow('重排详情面板', '点开角色后那个面板（About / 视频页两套）',
            fsw('data-ssp-detail-toggle="1"', detailEnabled())),
        frow('版头样式', '', `<select class="ssp-inp" data-ssp-detail-style="1">
            <option value="about"${detailStyle() === 'about' ? ' selected' : ''}>About. 字段列</option>
            <option value="video"${detailStyle() === 'video' ? ' selected' : ''}>视频页（播放器皮肤）</option>
        </select>`),
    ].join(''), 'About 版＝左边大头像、右边一列从卡里自动抓的字段；视频页版＝头像拉成 16:9 当播放器，'
        + '标签变话题 chips、按钮变点赞栏、收藏变「订阅」。两种都保留下面的标签 / 注释 / 描述。');

    /* —— 导入即更新 —— */
    const secImport = sec('fa-file-import', '导入即更新', [
        frow('认出重复卡时问我', '把「导入 / 替换更新 / 从 URL 导入」并成一条路',
            fsw('data-ssp-importmerge="1"', importMergeOn())),
        frow('人设重合度阈值', '文字重合到这个程度就算同一张卡',
            `<input class="ssp-range" type="range" min="30" max="90" step="5" value="${pct}" data-ssp-impsim="1">`
            + `<b class="ssp-out" data-ssp-impout="1">${pct}%</b>`),
    ].join(''), '认卡顺序：<b>卡里的姓名</b> → <b>人设文字重合度</b> → 文件名。认出重复会问你「更新这一张 / 另存为新角色」；'
        + '更新后会自动补回局部正则 / 收藏 / 世界书绑定 / 深度提示。认不出的新卡直接导入，不弹窗。');

    /* —— 悬浮球（鼠鼠口袋）—— */
    const secOrb = sec('fa-circle-nodes', '悬浮球（鼠鼠口袋）', [
        frow('显示悬浮球', '右下角一颗菱形球，展开是番外库（可拖动换位置）',
            fsw('data-ssp-orbon="1"', s.orbOn !== false)),
    ].join(''), '番外一条一条存，支持复制 / 一键插进输入框；数据存在扩展设置里，跟着酒馆备份走。以后要加别的功能，也是往这个球里塞模块。');
    /* —— 思维链收纳 —— */
    const secThink = sec('fa-brain', '思维链收纳', [
        frow('收纳思维链', '续写不再把 &lt;think&gt; 吐回正文',
            fsw('data-ssp-thinkshield="1"', s.thinkShield !== false)),
        frow('加载时清理', '切换 / 加载聊天时顺手收纳历史消息',
            fsw('data-ssp-thinkload="1"', s.thinkOnChatLoad !== false)),
        frow('思维链标签', '逗号分隔',
            `<input class="ssp-inp wide" type="text" data-ssp-thinktags="1" value="${esc(s.thinkTags || 'think,thinking,thought')}">`),
    ].join(''), '思维链<b>不会被删除</b>：都进了消息上方的「思考」折叠块，点开能看、能复制、能编辑。'
        + '想连流式输出那半截也不上屏，把酒馆自带「高级格式化 → Reasoning」的标签也打开。');

    return `
    <div class="ssp-p-mask" data-ssp-panel-close="1"></div>
    <div class="ssp-p" id="ssp_panel" role="dialog" aria-label="鼠鼠小助手设置">
      <div class="ssp-p-head">
        <div class="ssp-p-logo">🐭</div>
        <div class="ssp-p-title"><b>鼠鼠小助手</b><small>ShuShu Tweaks · v${PANEL_VERSION}</small></div>
        <div class="ssp-p-x" data-ssp-panel-close="1" title="关闭"><i class="fa-solid fa-xmark"></i></div>
      </div>
      <div class="ssp-p-body">
        ${secOrb}${secThink}${secCard}${secDetail}${secImport}${secBuild}${secSort}
      </div>
      <div class="ssp-p-foot">
        <span>改完立刻生效并落盘，不用点保存</span>
        <span class="ssp-p-foot-r">Esc 关闭</span>
      </div>
    </div>`;
}

/ 建面板（只建一次，建完留在 DOM 里，靠 .on 显隐） */
function mountSettingsPanel() {
    if (document.getElementById('ssp_panel')) return true;
    if (!document.body) return false;
    const box = document.createElement('div');
    box.id = 'ssp_panel_root';
    box.innerHTML = settingsPanelHTML();
    document.body.append(box);
    panelEl = document.getElementById('ssp_panel');
    return true;
}

function panelOpen() { return !!(panelEl && panelEl.classList && panelEl.classList.contains('on')); }

function openSettingsPanel() {
    mountSettingsPanel();
    bindSettingsOnce();
    if (panelEl) {
        panelEl.classList.add('on');
        const box = document.getElementById('ssp_panel_root');
        if (box && box.classList) box.classList.add('on');
    }
    return true;
}

function closeSettingsPanel() {
    if (panelEl) panelEl.classList.remove('on');
    const box = document.getElementById('ssp_panel_root');
    if (box && box.classList) box.classList.remove('on');
    return true;
}

function refreshCardSection() {
    const slot = document.getElementById('ssp_cardslot');
    if (slot) slot.innerHTML = cardDrawerHTML();
    return true;
}

/** 面板只绑一次（用标记记着，重复调用不会叠监听） */
function bindSettingsOnce() {
    if (bindSettingsOnce.done) return false;
    bindSettingsOnce.done = true;
    const box = document.getElementById('ssp_panel_root');
    if (box) {
        bindSettings(box);                       // 老的设置逻辑整体复用（data-ssp-* 一模一样）
        box.addEventListener('click', ev => {
            if (ev.target.closest && ev.target.closest('[data-ssp-panel-close]')) closeSettingsPanel();
        });
    }
    document.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && panelOpen()) closeSettingsPanel();
    });
    return true;
}

/** 抽屉里的「角色卡样式」那一块 */
function cardDrawerHTML() {
    const c = cardStyleSettings();
    const on = c.style !== 'none';
    const opts = ['<option value="none">原版（不改动）</option>']
        .concat(CARD_STYLE_ORDER.filter(k => CARD_STYLES[k])
            .map(k => `<option value="${k}"${c.style === k ? ' selected' : ''}>${esc(CARD_STYLES[k].name)}　${esc(CARD_STYLES[k].hint)}</option>`))
        .join('');
    const sel = (key, list) => `<select class="text_pole ssp-cinput" data-ssp-card-select="${key}">` + list
        .map(([v, n]) => `<option value="${v}"${c[key] === v ? ' selected' : ''}>${n}</option>`).join('') + '</select>';
    const row = (label, inner, wide) => `<div class="ssp-crow${wide ? ' wide' : ''}"><span class="ssp-clabel">${label}</span>${inner}</div>`;
    const slider = (key, label, min, max, step, unit) => row(label,
        `<input class="ssp-crange" type="range" data-ssp-card-knob="${key}" min="${min}" max="${max}" step="${step}" value="${c[key]}">
         <b class="ssp-cval" data-ssp-card-out="${key}">${c[key]}${unit}</b>`);
    const check = (key, label) => `<label class="ssp-ccheck"><input type="checkbox" data-ssp-card-check="${key}" ${c[key] ? 'checked' : ''}><span>${label}</span></label>`;
    return `<div class="ssp-cardsec"${on ? '' : ' hidden'}>
        ${row('角色卡样式', '<select class="text_pole ssp-cinput" data-ssp-card-style="1">' + opts + '</select>')}
        ${row('高清头像', '<label class="ssp-ccheck"><input type="checkbox" data-ssp-card-check="hd" ' + (c.hd ? 'checked' : '') + '><span>换成原图（酒馆缩略图只有 96×144，铺满整行会糊）</span></label>', true)}
        ${row('图片颜色', sel('color', [['hover', '悬停变彩'], ['always', '一直彩色'], ['gray', '一直灰']]))}
        ${row('渐隐方式', sel('fade', [['mask', '遮罩（自适应底色）'], ['solid', '色块覆盖'], ['none', '不渐隐']]))}
        ${slider('fadeStop', '渐隐强度', 0, 100, 1, '%')}
        ${row('取景', sel('focus', [['18%', '偏上'], ['32%', '居中'], ['62%', '偏下']]))}
        ${row('内容对齐', sel('align', [['left', '靠左'], ['center', '居中'], ['right', '靠右']]))}
        ${slider('h', '卡片高度', 40, 420, 1, 'px')}
        ${slider('radius', '圆角', 0, 40, 1, 'px')}
        ${slider('gap', '卡片间距', 0, 40, 1, 'px')}
        ${slider('overlay', '叠压程度', 0, 90, 5, '%')}
        ${slider('name', '名字字号', 10, 34, 0.5, 'px')}
        ${slider('desc', '简介字号', 8, 24, 0.5, 'px')}
        ${row('歌单底色', `<input type="color" class="ssp-ccolor" data-ssp-card-color="songBg" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.songBg)) ? c.songBg : '#4a2b7d')}" title="只有「歌单行」样式用得到">
            <b class="ssp-cval" data-ssp-card-out="songBg">${esc(String(c.songBg || '#4a2b7d'))}</b>
            <span class="ssp-creset menu_button" data-ssp-card-color="songBg" data-ssp-color-reset="1">默认紫</span>`, true)}
        ${row('显示什么', `<div class="ssp-csws">${check('showDesc', '简介')}${check('showTags', '标签')}${check('showVer', '版本号')}${check('showStar', '收藏标记')}</div>`, true)}
        ${row('学生证', `<input class="text_pole ssp-cinput" data-ssp-card-text="school" value="${esc(c.school)}" placeholder="校名">
            <input class="text_pole ssp-cyear" data-ssp-card-text="year" value="${esc(c.year)}" placeholder="年份">
            <select class="text_pole ssp-cyear" data-ssp-card-select="idTheme" title="证件配色">${Object.keys(CARD_ID_THEMES)
            .map(k => `<option value="${k}"${c.idTheme === k ? ' selected' : ''}>${CARD_ID_THEMES[k].name}</option>`).join('')}</select>`, true)}
        <div class="ssp-note" style="opacity:.6">9 种样式的完整预览在 <b>角色卡美化-原型.html</b> 里；
        ▦ 网格模式会被接管成两列封面墙。</div>
        <div class="ssp-crow"><span class="ssp-clabel">对不上图？</span>
        <div class="menu_button" data-ssp-card-measure="1" title="量一下前三张卡的实际尺寸，把结果发我最快">量一下卡片</div></div>
        <pre class="ssp-measure" data-ssp-card-out2="1" hidden></pre></div>`;
}
/** 诊断：把前三张卡的真实计算尺寸量出来（我这边看不到你的 DOM，靠这个定位） */
function measureCards() {
    const cards = queryAll('#rm_print_characters_block .character_select').slice(0, 3);
    const info = getContext?.() ? true : false;
    if (!cards.length) return '一张卡都没找到（#rm_print_characters_block .character_select 为空）';
    const lines = ['样式：' + (CARD_STYLES[cardStyleSettings().style] || { name: '原版' }).name,
        '--- 卡片 ---'];
    cards.forEach((el, i) => {
        const cs = globalThis.getComputedStyle ? globalThis.getComputedStyle(el) : null;
        const av = el.querySelector?.('.avatar');
        const avcs = (av && globalThis.getComputedStyle) ? globalThis.getComputedStyle(av) : null;
        const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { width: 0, height: 0 };
        lines.push('#' + (i + 1) + ' 高 ' + Math.round(r.height) + 'px 宽 ' + Math.round(r.width) + 'px' +
            (cs ? ' | height:' + cs.height + ' margin:' + cs.marginTop + '/' + cs.marginBottom +
                ' padding:' + cs.paddingTop + '/' + cs.paddingBottom + ' overflow:' + cs.overflow : '') +
            (avcs ? ' || 头像 ' + avcs.width + '×' + avcs.height + ' pos:' + avcs.position : ''));
    });
    lines.push('--- 列表容器 ---');
    const list = query('#rm_print_characters_block');
    if (list && globalThis.getComputedStyle) {
        const ls = globalThis.getComputedStyle(list);
        lines.push('display:' + ls.display + ' gap:' + ls.gap + ' flexDirection:' + ls.flexDirection);
    }
    lines.push('--- 注入的样式（前 12 行）---');
    const st = document.getElementById(CARD_STYLE_ID);
    lines.push(st ? st.textContent.split('\n').slice(0, 12).join('\n') : '(没有注入)');
    return lines.join('\n');
}
/** 重建「角色卡样式」那一段（换样式后滑块位置/下拉选中要跟着变；「原版」时整段收起） */
/* 旧版 refreshCardSection 已由面板里的新版取代（旧版只在抽屉里找槽位，抽屉已经没有槽位了） */


/* ==========================================================================
   生命周期
   ========================================================================== */
function reclaim(reason) {
    const s = getSettings();
    if (!s.enabled) return;
    apply();
    // 角色卡样式：列表每次重画都会换回缩略图/丢掉样式，所以这里要重新认领
    applyCardStyle();
    applyCardOrder();            // 手动排序：重画/翻页后重新按你的顺序排
    trimListCreatorNotes();      // 作者注释只留第一行（酒馆重画后要重新截）
    setCardAvatarVars();         // 学生证的右侧图片影子
    applyDetailHeader();         // 角色详情页版头（点开角色后那块）
    if (sortMode) insertSortHint();
    if (!document.getElementById(MOUNT_ID)) ensureMount();
    if (boxOpen) renderMount();
}

/* ==========================================================================
   🐭 悬浮球（#ssp_orb）+ 鼠鼠口袋
   --------------------------------------------------------------------------
   用户要的：一颗悬浮球（图案 = 菱形方块，黑白配色），展开里面是「番外」库：
   一条一条存小短文，可复制 / 一键插进输入框。面板做成模块容器，以后加功能往里塞。
   实现上的三个坑（都踩过，写在这儿别再踩）：
     ① 球必须**直接挂 body**：放进任何有尺寸的容器里，那个容器就可能成为它的包含块
        （实测顶到屏幕外 top=-148 = -(bottom 96 + 高 52)）。
     ② 本块代码必须位于 init() **之前**：否则 init 执行时 const/let 还在 TDZ，
        会抛 "Cannot access 'xxx' before initialization"。
     ③ 重画面板只换面板**内部**，绝不重画整个容器 —— 否则球会跟着被替换掉。
   ========================================================================== */
var orbBuilt = false;
var orbEdge = { right: 18, bottom: 96 };   // 球离右边/下边的距离（贴边靠它）
var orbOpenNow = false;
var orbEditing = null;
var orbTab = 'notes';       // 当前模块页（模块容器：以后加功能只加标签页）
var orbBinding = null;      // 正在给哪个面具选绑定角色（null = 不在绑定模式）
var orbPersonaEdit = null;  // 正在编辑哪个面具（null = 不在编辑模式）
var orbPSearch = '';        // 面具页的搜索词（角色卡名 / 面具名 / 描述）
var orbPresetBinding = null;// 正在给哪个预设选绑定角色
var orbPreSearch = '';      // 预设页搜索词

/* ============================ 存档（聊天记录）栏 ============================
   把酒馆的「聊天记录」搬进来：列出当前角色的所有 .jsonl 存档 → 读档 / 删除。
     列表：POST /api/characters/chats  { avatar_url }
     读档：上下文里的 openCharacterChat(file)（酒馆自己导出的函数，直接调 ✓）
     删除：POST /api/chats/delete  { chatfile, avatar_url }
   列表是异步拉的，所以渲染用缓存 + 打开时拉一次 + 手动「刷新」。
   ========================================================================== */
var orbChatList = [];        // 缓存：[{file, name, time}]
var orbChatLoading = false;
var orbChatErr = '';
var orbChSearch = '';

function orbChatCtx() { return getContext() || {}; }
function orbChatChar() { return orbPresetCurChar(); }          // 复用：当前聊天角色
function orbCurChatId() { try { return orbChatCtx().getCurrentChatId() || ''; } catch (e) { return ''; } }

async function orbChatsFetch() {
    const ch = orbChatChar();
    if (!ch) { orbChatErr = '当前没有打开任何角色聊天'; orbChatList = []; return false; }
    orbChatLoading = true; orbChatErr = '';
    if (orbOpenNow) renderOrbPanel();
    try {
        const res = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: orbChatCtx().getRequestHeaders(),
            body: JSON.stringify({ avatar_url: ch.avatar }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const arr = Array.isArray(data) ? data : (data.chats || []);
        orbChatList = arr.map(it => {
            const file = String(it.file_name || it.file || '');
            return { file: file, name: file.replace(/\.jsonl$/, ''), time: it.last_mes || it.file_size || '' };
        });
    } catch (e) {
        orbChatErr = '拉列表失败：' + e.message;
        orbChatList = [];
    }
    orbChatLoading = false;
    if (orbOpenNow) renderOrbPanel();
    return true;
}

function orbChatLoad(file) {
    const ctx = orbChatCtx();
    if (!ctx.openCharacterChat) { toast('酒馆没暴露 openCharacterChat', 'warning'); return false; }
    /* ⚠️ openCharacterChat 收的是**不带扩展名**的聊天名。
       传 "...xxx.jsonl" 进去，酒馆会再补一个 .jsonl → 生成 xxx.jsonl.jsonl（多出一个假存档，实测踩到过）。 */
    const name = String(file || '').replace(/\.jsonl$/i, '');
    try {
        ctx.openCharacterChat(name);
        toast('已读档：' + name, 'success');
        setTimeout(() => { if (orbOpenNow) renderOrbPanel(); }, 800);
        return true;
    } catch (e) { toast('读档失败：' + e.message, 'warning'); return false; }
}

/** 存档改名：走酒馆的 renameChat（它内部还会清洗非法字符）
    ⚠️ 名字带不带 .jsonl 这里不赌 —— 先按不带扩展名试，失败再用带扩展名的试一次。 */
async function orbChatRename(file, newName) {
    const ctx = orbChatCtx();
    if (!ctx.renameChat) { toast('酒馆没暴露 renameChat', 'warning'); return false; }
    const oldBase = String(file || '').replace(/\.jsonl$/i, '');
    const nn = String(newName || '').trim();
    if (!nn) { toast('名字不能为空', 'warning'); return false; }
    try {
        await ctx.renameChat(oldBase, nn);
        toast('已改名：' + nn, 'success');
        setTimeout(() => orbChatsFetch(), 900);
        return true;
    } catch (e) {
        try {
            await ctx.renameChat(String(file), nn);            // 兜底：带扩展名再试一次
            toast('已改名：' + nn, 'success');
            setTimeout(() => orbChatsFetch(), 900);
            return true;
        } catch (e2) {
            toast('改名失败：' + (e2 && e2.message ? e2.message : e.message), 'warning');
            return false;
        }
    }
}

async function orbChatDelete(file) {    const ch = orbChatChar();
    if (!ch) return false;
    try {
        const res = await fetch('/api/chats/delete', {
            method: 'POST',
            headers: orbChatCtx().getRequestHeaders(),
            body: JSON.stringify({ chatfile: file, avatar_url: ch.avatar }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        orbChatList = orbChatList.filter(x => x.file !== file);
        toast('已删除存档：' + String(file).replace(/\.jsonl$/, ''), 'info');
        if (orbOpenNow) renderOrbPanel();
        return true;
    } catch (e) { toast('删除失败：' + e.message, 'warning'); return false; }
}

function orbChatRowsHTML() {
    const ch = orbChatChar();
    if (!ch) return '<div class="ssp-orb-empty">先在酒馆里打开一个角色聊天，这里才会列出存档。</div>';
    if (orbChatLoading) return '<div class="ssp-orb-empty">正在读存档列表…</div>';
    if (orbChatErr) return '<div class="ssp-orb-empty">' + esc(orbChatErr) + '</div>';
    if (!orbChatList.length) return '<div class="ssp-orb-empty">这个角色还没有存档（酒馆里聊过就会有）。</div>';
    const cur = orbCurChatId();
    const q = orbChSearch.toLowerCase();
    const hit = orbChatList.filter(x => !q
        || String(x.name).toLowerCase().indexOf(q) >= 0
        || String(x.time).toLowerCase().indexOf(q) >= 0);
    if (!hit.length) return '<div class="ssp-orb-empty">没有匹配「' + esc(orbChSearch) + '」的存档。</div>';
    const head = orbChSearch ? '<div class="ssp-orb-pcount">筛选出 ' + hit.length + ' / ' + orbChatList.length + ' 个存档</div>' : '';
    const rows = hit.map(x => {
        const on = (x.name === cur);
        return '<div class="ssp-orb-prow' + (on ? ' on' : '') + '">'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(x.name) + (on ? '<span class="ssp-orb-ptag">当前</span>' : '') + '</div>'
            + (x.time ? '<div class="ssp-orb-pdesc">' + esc(String(x.time).slice(0, 70)) + '</div>' : '')
            + '</div>'
            + '<div class="ssp-orb-pacts">'
            + '<span class="ssp-pbtn' + (on ? ' primary' : '') + '" data-orb-chatload="' + esc(x.file) + '">' + (on ? '当前' : '读档') + '</span>'
            + '<span class="ssp-pbtn" data-orb-chatren="' + esc(x.file) + '" data-orb-chatname="' + esc(x.name) + '"><i class="fa-solid fa-pen"></i></span>'
            + '<span class="ssp-pbtn danger" data-orb-chatdel="' + esc(x.file) + '" data-orb-chatname="' + esc(x.name) + '"><i class="fa-solid fa-trash"></i></span>'
            + '</div></div>';
    }).join('');
    return head + '<div class="ssp-orb-plist">' + rows + '</div>';
}

function orbChatHTML() {
    const ch = orbChatChar();
    return '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-chsearch="1" placeholder="搜存档名 / 时间" value="' + esc(orbChSearch) + '">'
        + (orbChSearch ? '<span class="ssp-pbtn" data-orb-chclear="1">清除</span>' : '')
        + '<span class="ssp-pbtn" data-orb-chrefresh="1"><i class="fa-solid fa-rotate"></i>刷新</span>'
        + '</div>'
        + '<div id="ssp_orb_chat_list">' + orbChatRowsHTML() + '</div>'
        + '<div class="ssp-orb-empty" style="padding-top:6px">'
        + (ch ? ('角色：<b>' + esc(ch.name) + '</b>；当前存档：<b>' + esc(orbCurChatId() || '(未保存)') + '</b>。')
            : '')
        + '「读档」会切到那份存档（酒馆原生切法）；🗑 直接删文件，删了救不回来。</div>';
}

/* ============================ 美化（主题）栏 ============================
   跟预设栏一个套路：酒馆没有「主题绑角色」的原生功能，所以
     读/切：驱动酒馆自己的主题下拉框 #themes（按文字找 option → 设 value → 派发 change）
     绑定：themeBinds[角色头像] = 主题名，存本扩展设置
     自动：切聊天时看当前角色绑了哪个主题 → 自动换 + 弹提示
   ⚠️ 别假设 option 的 value 是什么（预设那边 value 就是序号）——
      一律「按文字找到 option，再用它自己的 value」，两种都吃得下。
   ========================================================================== */
var orbThemeBinding = null;
var orbThSearch = '';

function orbThemeSel() { return document.getElementById('themes'); }
function orbThemeList() {
    const sel = orbThemeSel();
    if (!sel) return [];
    return Array.from(sel.options).map(o => (o.textContent || '').trim()).filter(Boolean);
}
function orbThemeCur() {
    const sel = orbThemeSel();
    if (!sel || sel.selectedIndex < 0 || !sel.options[sel.selectedIndex]) return '';
    return (sel.options[sel.selectedIndex].textContent || '').trim();
}
function orbThemePick(name) {
    const want = String(name || '').trim();
    if (!want) return false;
    const sel = orbThemeSel();
    if (!sel) { toast('找不到酒馆的主题下拉框', 'warning'); return false; }
    const opt = Array.from(sel.options).find(o => (o.textContent || '').trim() === want);
    if (!opt) { toast('找不到主题「' + want + '」', 'warning'); return false; }
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}
function orbThemeBinds() {
    const s = getSettings();
    if (!s.themeBinds || typeof s.themeBinds !== 'object') s.themeBinds = {};
    return s.themeBinds;
}
function orbThemeAuto() {
    const s = getSettings();
    if (typeof s.themeAuto !== 'boolean') s.themeAuto = true;
    return s.themeAuto;
}
function orbThemeCharNames(name) {
    const b = orbThemeBinds(), chars = orbCharList();
    return Object.keys(b).filter(k => b[k] === name)
        .map(k => (chars.find(c => c.id === k) || {}).name || k);
}
function orbThemeBind(charAvatar, name) {
    const b = orbThemeBinds();
    if (name) b[charAvatar] = name; else delete b[charAvatar];
    save();
}
function orbThemeAutoApply() {
    if (!orbThemeAuto()) return false;
    const ch = orbPresetCurChar();                 // 复用：拿当前聊天角色
    if (!ch) return false;
    const want = orbThemeBinds()[ch.avatar];
    if (!want) return false;
    if (orbThemeCur() === want) return false;
    if (orbThemeList().indexOf(want) < 0) { toast('绑的主题「' + want + '」已经找不到了', 'warning'); return false; }
    if (orbThemePick(want)) {
        toast('自动换美化：' + want + '（' + ch.name + ' 绑的）', 'info');
        if (orbOpenNow) renderOrbPanel();
        return true;
    }
    return false;
}
function orbThemeRowsHTML() {
    const all = orbThemeList();
    const cur = orbThemeCur();
    if (!all.length) return '<div class="ssp-orb-empty">没读到主题（找不到酒馆的主题下拉框 #themes）。</div>';
    const q = orbThSearch.toLowerCase();
    const hit = all.filter(n => !q
        || String(n).toLowerCase().indexOf(q) >= 0
        || orbThemeCharNames(n).join('、').toLowerCase().indexOf(q) >= 0);
    if (!hit.length) return '<div class="ssp-orb-empty">没有匹配「' + esc(orbThSearch) + '」的主题。<br>（搜的是：主题名 / 绑定在这上面的角色卡名）</div>';
    const head = orbThSearch ? '<div class="ssp-orb-pcount">筛选出 ' + hit.length + ' / ' + all.length + ' 个主题</div>' : '';
    const rows = hit.map(n => {
        const on = (n === cur);
        const names = orbThemeCharNames(n);
        return '<div class="ssp-orb-prow' + (on ? ' on' : '') + '">'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(n) + (on ? '<span class="ssp-orb-ptag">当前</span>' : '') + '</div>'
            + '<div class="ssp-orb-pbind' + (names.length ? ' has' : '') + '"><i class="fa-solid fa-link"></i>'
            + (names.length ? esc(names.join('、')) : '未绑定角色') + '</div>'
            + '</div>'
            + '<div class="ssp-orb-pacts">'
            + '<span class="ssp-pbtn' + (on ? ' primary' : '') + '" data-orb-theme="' + esc(n) + '">' + (on ? '当前' : '用这个') + '</span>'
            + '<span class="ssp-pbtn" data-orb-tbind="' + esc(n) + '"><i class="fa-solid fa-link"></i>绑定</span>'
            + '</div></div>';
    }).join('');
    return head + '<div class="ssp-orb-plist">' + rows + '</div>';
}
function orbThemeHTML() {
    if (orbThemeBinding) return orbThemePickerHTML(orbThemeBinding);
    if (!orbThemeList().length) return orbThemeRowsHTML();
    return '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-thsearch="1" placeholder="搜主题 / 角色卡" value="' + esc(orbThSearch) + '">'
        + (orbThSearch ? '<span class="ssp-pbtn" data-orb-thclear="1">清除</span>' : '')
        + '</div>'
        + '<div class="ssp-orb-pcount"><label class="ssp-orb-auto"><input type="checkbox" data-orb-thauto="1"'
        + (orbThemeAuto() ? ' checked' : '') + '><span>切到绑定的角色时自动换美化（会弹提示）</span></label></div>'
        + '<div id="ssp_orb_theme_list">' + orbThemeRowsHTML() + '</div>'
        + '<div class="ssp-orb-empty" style="padding-top:6px">当前美化：<b>' + esc(orbThemeCur() || '(读不到)') + '</b>'
        + '；「用这个」立刻换，「绑定」选角色 —— <b>一个主题能绑多个角色卡</b>，一张角色卡只认一个主题。</div>';
}
function orbThemePickerHTML(name) {
    const b = orbThemeBinds();
    const chars = orbCharList();
    const rows = chars.length ? chars.map(c => {
        const mine = (b[c.id] === name);
        const other = (b[c.id] && b[c.id] !== name) ? b[c.id] : '';
        return '<div class="ssp-orb-charrow' + (mine ? ' on' : '') + '" data-orb-tbindchar="' + esc(c.id) + '" data-orb-tbindname="' + esc(name) + '">'
            + '<img src="/thumbnail?type=avatar&file=' + encodeURIComponent(c.id) + '" alt="">'
            + '<span class="ssp-orb-charn">' + esc(c.name) + (other ? '<i style="opacity:.5"> · 现在绑的是「' + esc(other) + '」</i>' : '') + '</span>'
            + '<span class="ssp-orb-charmark">' + (mine ? '<i class="fa-solid fa-check"></i> 已绑定' : '<i class="fa-regular fa-circle"></i>') + '</span>'
            + '</div>';
    }).join('') : '<div class="ssp-orb-empty">没读到角色列表。</div>';
    const conns = orbThemeCharNames(name);
    return '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-themeback="1"><i class="fa-solid fa-arrow-left"></i>返回</span>'
        + '<b>' + esc(name) + ' · 绑定角色</b>'
        + '<span class="ssp-orb-charmark" style="margin-left:auto">已绑 ' + conns.length + ' 个</span>'
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">点角色＝绑到它 / 再点＝解除。<b>一个主题可以绑多个角色卡</b>；一张角色卡只认一个主题（绑新的会盖掉旧的）。</div>'
        + '<div class="ssp-orb-charrows">' + rows + '</div>'
        + (conns.length ? '<div class="ssp-orb-empty" style="padding-top:6px">已绑定：' + esc(conns.join('、')) + '</div>' : '');
}

/* ============================ 预设（采样预设）栏 ============================
   酒馆没有「预设绑角色」的原生功能，所以：
     读/切：官方 API —— getPresetManager('openai') 的 getAllPresets / getSelectedPresetName / selectPreset
     绑定关系：存在本扩展设置里（presetBinds[api][角色头像] = 预设名），跟着酒馆备份走
     自动切换：切聊天（CHAT_CHANGED）时，看当前角色绑了哪个预设 → 自动 selectPreset + 弹提示
   ========================================================================== */
var ORB_PRESET_API = 'openai';          // 聊天补全预设（第三方 API 用的就是这个）

function orbPresetMgr() {
    try { return (getContext() || {}).getPresetManager(ORB_PRESET_API); } catch (e) { return null; }
}
function orbPresetList() {
    const m = orbPresetMgr();
    if (!m) return [];
    try { return (m.getAllPresets() || []).slice(); } catch (e) { return []; }
}
function orbPresetCur() {
    /* 优先读酒馆自己的下拉框（最准）；读不到再退回官方 API */
    try {
        const sel = document.getElementById('settings_preset_openai');
        if (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) {
            return (sel.options[sel.selectedIndex].textContent || '').trim();
        }
    } catch (e) { }
    const m = orbPresetMgr();
    if (!m) return '';
    try {
        if (typeof m.getSelectedPresetName === 'function') return m.getSelectedPresetName() || '';
        return String(m.getSelectedPreset() || '');
    } catch (e) { return ''; }
}

/** 切预设。
    ⚠️ 不能直接 selectPreset(预设名)：openai 预设下拉的 value 是**序号**（"0"/"1"…），
    传名字会切失败（实测切完 getSelectedPresetName() 变空）。
    所以走「驱动酒馆自己的下拉框」这条路 —— 跟面具切换一个思路，借酒馆原生 handler。 */
function orbPresetPick(name) {
    const want = String(name || '').trim();
    if (!want) return false;
    try {
        const sel = document.getElementById('settings_preset_openai');
        if (sel) {
            const opt = Array.from(sel.options).find(o => (o.textContent || '').trim() === want);
            if (opt) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
    } catch (e) { }
    /* 退路：官方 API（有的管理器收的就是名字） */
    const m = orbPresetMgr();
    if (m) { try { m.selectPreset(want); return true; } catch (e) { toast('换预设失败：' + e.message, 'warning'); } }
    return false;
}
function orbPresetBinds() {
    const s = getSettings();
    if (!s.presetBinds || typeof s.presetBinds !== 'object') s.presetBinds = {};
    if (!s.presetBinds[ORB_PRESET_API] || typeof s.presetBinds[ORB_PRESET_API] !== 'object') s.presetBinds[ORB_PRESET_API] = {};
    return s.presetBinds[ORB_PRESET_API];
}
function orbPresetAuto() {
    const s = getSettings();
    if (typeof s.presetAuto !== 'boolean') s.presetAuto = true;
    return s.presetAuto;
}
/** 谁绑了这个预设（返回角色名数组） */
function orbPresetCharNames(name) {
    const b = orbPresetBinds(), chars = orbCharList();
    return Object.keys(b).filter(k => b[k] === name)
        .map(k => (chars.find(c => c.id === k) || {}).name || k);
}
function orbPresetBind(charAvatar, name) {
    const b = orbPresetBinds();
    if (name) b[charAvatar] = name; else delete b[charAvatar];
    save();
}
function orbPresetCurChar() {
    const ctx = getContext() || {};
    const ch = (ctx.characters || [])[ctx.characterId];
    return ch && ch.avatar ? ch : null;
}
/** 切角色/切聊天时自动换预设 */
function orbPresetAutoApply() {
    if (!orbPresetAuto()) return false;
    const ch = orbPresetCurChar();
    if (!ch) return false;
    const want = orbPresetBinds()[ch.avatar];
    if (!want) return false;
    if (orbPresetCur() === want) return false;
    if (orbPresetList().indexOf(want) < 0) { toast('绑的预设「' + want + '」已经找不到了', 'warning'); return false; }
    if (orbPresetPick(want)) {
        toast('自动换预设：' + want + '（' + ch.name + ' 绑的）', 'info');
        if (orbOpenNow) renderOrbPanel();
        return true;
    }
    return false;
}

function orbPresetRowsHTML() {
    const all = orbPresetList();
    const cur = orbPresetCur();
    if (!all.length) return '<div class="ssp-orb-empty">没读到预设（预设管理器拿不到）。</div>';
    const q = orbPreSearch.toLowerCase();
    const hit = all.filter(n => !q
        || String(n).toLowerCase().indexOf(q) >= 0
        || orbPresetCharNames(n).join('、').toLowerCase().indexOf(q) >= 0);
    if (!hit.length) return '<div class="ssp-orb-empty">没有匹配「' + esc(orbPreSearch) + '」的预设。<br>（搜的是：预设名 / 绑定在这上面的角色卡名）</div>';
    const head = orbPreSearch ? '<div class="ssp-orb-pcount">筛选出 ' + hit.length + ' / ' + all.length + ' 个预设</div>' : '';
    const rows = hit.map(n => {
        const on = (n === cur);
        const names = orbPresetCharNames(n);
        return '<div class="ssp-orb-prow' + (on ? ' on' : '') + '">'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(n) + (on ? '<span class="ssp-orb-ptag">当前</span>' : '') + '</div>'
            + '<div class="ssp-orb-pbind' + (names.length ? ' has' : '') + '"><i class="fa-solid fa-link"></i>'
            + (names.length ? esc(names.join('、')) : '未绑定角色') + '</div>'
            + '</div>'
            + '<div class="ssp-orb-pacts">'
            + '<span class="ssp-pbtn' + (on ? ' primary' : '') + '" data-orb-preset="' + esc(n) + '">' + (on ? '当前' : '用这个') + '</span>'
            + '<span class="ssp-pbtn" data-orb-pbind="' + esc(n) + '"><i class="fa-solid fa-link"></i>绑定</span>'
            + '</div></div>';
    }).join('');
    return head + '<div class="ssp-orb-plist">' + rows + '</div>';
}

function orbPresetHTML() {
    if (orbPresetBinding) return orbPresetPickerHTML(orbPresetBinding);
    const all = orbPresetList();
    if (!all.length) return orbPresetRowsHTML();
    return '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-presearch="1" placeholder="搜预设 / 角色卡" value="' + esc(orbPreSearch) + '">'
        + (orbPreSearch ? '<span class="ssp-pbtn" data-orb-preclear="1">清除</span>' : '')
        + '</div>'
        + '<div class="ssp-orb-pcount"><label class="ssp-orb-auto"><input type="checkbox" data-orb-pauto="1"'
        + (orbPresetAuto() ? ' checked' : '') + '><span>切到绑定的角色时自动换预设（会弹提示）</span></label></div>'
        + '<div id="ssp_orb_preset_list">' + orbPresetRowsHTML() + '</div>'
        + '<div class="ssp-orb-empty" style="padding-top:6px">当前预设：<b>' + esc(orbPresetCur() || '(读不到)') + '</b>'
        + '；「用这个」立刻切，「绑定」选角色 —— <b>一个预设能绑多个角色卡</b>（点几个绑几个），一张角色卡只认一个预设。</div>';
}

function orbPresetPickerHTML(name) {
    const conns = orbPresetCharNames(name);
    const b = orbPresetBinds();
    const chars = orbCharList();
    const rows = chars.length ? chars.map(c => {
        const mine = (b[c.id] === name);
        const other = (b[c.id] && b[c.id] !== name) ? b[c.id] : '';
        return '<div class="ssp-orb-charrow' + (mine ? ' on' : '') + '" data-orb-pbindchar="' + esc(c.id) + '" data-orb-pbindname="' + esc(name) + '">'
            + '<img src="/thumbnail?type=avatar&file=' + encodeURIComponent(c.id) + '" alt="">'
            + '<span class="ssp-orb-charn">' + esc(c.name) + (other ? '<i style="opacity:.5"> · 现在绑的是「' + esc(other) + '」</i>' : '') + '</span>'
            + '<span class="ssp-orb-charmark">' + (mine ? '<i class="fa-solid fa-check"></i> 已绑定' : '<i class="fa-regular fa-circle"></i>') + '</span>'
            + '</div>';
    }).join('') : '<div class="ssp-orb-empty">没读到角色列表。</div>';
    return '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-presetback="1"><i class="fa-solid fa-arrow-left"></i>返回</span>'
        + '<b>' + esc(name) + ' · 绑定角色</b>'
        + '<span class="ssp-orb-charmark" style="margin-left:auto">已绑 ' + conns.length + ' 个</span>'
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">点角色＝绑到它 / 再点＝解除。<b>一个预设可以绑多个角色卡</b>（点几个绑几个）；一张角色卡只认一个预设（绑新的会盖掉旧的）。</div>'
        + '<div class="ssp-orb-charrows">' + rows + '</div>'
        + (conns.length ? '<div class="ssp-orb-empty" style="padding-top:6px">已绑定：' + esc(conns.join('、')) + '</div>' : '');
}


function orbNotes() {
    const s = getSettings();
    if (!Array.isArray(s.notes)) s.notes = [];
    return s.notes;
}
function orbNewId() { return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }

function orbSaveNote(id, title, text) {
    const list = orbNotes();
    const t = String(title || '').trim();
    const body = String(text || '');
    if (!t && !body.trim()) return null;
    let rec = id ? list.find(n => n.id === id) : null;
    if (rec) { rec.title = t; rec.text = body; rec.at = Date.now(); }
    else { rec = { id: orbNewId(), title: t, text: body, at: Date.now() }; list.unshift(rec); }
    save();
    return rec;
}

function orbDelNote(id) {
    const s = getSettings();
    if (!Array.isArray(s.notes)) return false;
    const i = s.notes.findIndex(n => n.id === id);
    if (i < 0) return false;
    s.notes.splice(i, 1);
    save();
    return true;
}

async function orbCopy(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { }
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
        return true;
    } catch (e) { return false; }
}

function orbInsert(text) {
    const ta = document.getElementById('send_textarea');
    if (!ta) { toast('没找到输入框（先打开一个聊天）', 'warning'); return false; }
    ta.value = String(text || '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    try { ta.focus(); } catch (e) { }
    toast('已插进输入框', 'info');
    return true;
}

/** 面板里的模块表 —— 以后加功能往这里加一项 */
const ORB_MODULES = [
    { id: 'notes', name: '番外', icon: 'fa-feather-pointed', render: () => orbNotesHTML() },
    { id: 'persona', name: '面具', icon: 'fa-masks-theater', render: () => orbPersonaHTML() },
    { id: 'preset', name: '预设', icon: 'fa-sliders', render: () => orbPresetHTML() },
    { id: 'theme', name: '美化', icon: 'fa-palette', render: () => orbThemeHTML() },
    { id: 'chat', name: '存档', icon: 'fa-box-archive', render: () => orbChatHTML() },
];
function orbModule(id) { return ORB_MODULES.find(m => m.id === id) || null; }

/* ============================ 面具（用户设定）栏 ============================
   读：酒馆把面具放在 power_user.personas（id → 名字），上下文里能用
       SillyTavern.getContext().powerUserSettings 读到（实测可读 ✓）。
   切：不自己改数据，直接**点酒馆自己面具列表里那一项**（#user_avatar_block .avatar-container），
       走酒馆原生的切换逻辑，最稳。
   新建：点酒馆自己的加面具按钮（#add_avatar_button，是个隐藏的 file input）→ 走酒馆原生流程。
   ========================================================================== */
function orbPersonas() {
    const out = [];
    try {
        const ctx = getContext() || {};
        const pu = ctx.powerUserSettings || {};
        const map = pu.personas || {};
        Object.keys(map).forEach(id => out.push({ id: id, name: String(map[id] || id) }));
    } catch (e) { /* 读不到就退回 DOM */ }
    if (!out.length) {
        document.querySelectorAll('#user_avatar_block .avatar-container').forEach(c => {
            const img = c.querySelector('img');
            const m = img && /[?&]file=([^&]+)/.exec(img.getAttribute('src') || '');
            if (m) out.push({ id: decodeURIComponent(m[1]), name: (c.querySelector('.ch_name, b') || {}).textContent || m[1] });
        });
    }
    return out;
}

/** 当前戴着的面具 id（读酒馆列表里 .selected 那一项） */
function orbActivePersona() {
    const sel = document.querySelector('#user_avatar_block .avatar-container.selected img');
    const m = sel && /[?&]file=([^&]+)/.exec(sel.getAttribute('src') || '');
    if (m) return decodeURIComponent(m[1]);
    try { return (getContext().powerUserSettings || {}).default_persona || ''; } catch (e) { return ''; }
}

function orbPersonaThumb(id) { return '/thumbnail?type=persona&file=' + encodeURIComponent(id); }

/** 选一个面具：点酒馆自己列表里对应那一项 */
function orbPersonaSwitch(id) {
    const items = Array.from(document.querySelectorAll('#user_avatar_block .avatar-container'));
    for (const c of items) {
        const img = c.querySelector('img');
        const m = img && /[?&]file=([^&]+)/.exec(img.getAttribute('src') || '');
        if (m && decodeURIComponent(m[1]) === id) {
            c.click();
            toast('已换成：' + (orbPersonas().find(p => p.id === id) || {}).name, 'info');
            return true;
        }
    }
    toast('没在酒馆的面具列表里找到这一项（先打开一次「用户设定」面板）', 'warning');
    return false;
}

function orbPersonaNew() {
    /* 直接进「新建」表单：填名字/描述 → 保存时生成一张占位图并调酒馆的上传接口建出真面具。
       （以前是点酒馆的隐藏 file input，等于把用户丢进文件选择框 —— 用户不干。） */
    orbPersonaEdit = '__new__';
    renderOrbPanel();
    return true;
}

/** 生成一张占位头像（深色底 + 名字首字），用于新建面具 */
function orbPlaceholderBlob(name) {
    return new Promise(resolve => {
        try {
            const w = 240, h = 360;
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const g = cv.getContext('2d');
            const grad = g.createLinearGradient(0, 0, w, h);
            grad.addColorStop(0, '#2a2a33');
            grad.addColorStop(1, '#141419');
            g.fillStyle = grad; g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
            g.fillStyle = 'rgba(255,255,255,.9)';
            g.font = '700 130px -apple-system,"Microsoft YaHei",sans-serif';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            const ch = String(name || '新').trim().charAt(0) || '新';
            g.fillText(ch, w / 2, h / 2);
            cv.toBlob(b => resolve(b), 'image/png');
        } catch (e) { resolve(null); }
    });
}

/** 新建面具：上传占位图 → 写进酒馆的面具数据 → 返回新面具的 id */
async function orbPersonaCreate(name, desc) {
    const nm = String(name || '').trim() || '新面具';
    try {
        const blob = await orbPlaceholderBlob(nm);
        if (!blob) { toast('占位图生成失败，改用酒馆的上传', 'warning'); return null; }
        const ctx = getContext();
        const file = new File([blob], 'persona.png', { type: 'image/png' });
        const fd = new FormData();
        fd.append('avatar', file);
        fd.append('overwrite_name', nm);
        const res = await fetch('/api/avatars/upload', {
            method: 'POST',
            headers: ctx.getRequestHeaders({ omitContentType: true }),
            body: fd,
        });
        if (!res.ok) { toast('创建失败：' + res.status, 'warning'); return null; }
        const data = await res.json().catch(() => ({}));
        const path = data && data.path ? data.path : '';
        const id = String(path).split('/').pop();
        if (!id) { toast('创建失败：服务端没返回文件名', 'warning'); return null; }
        /* 写进酒馆的面具数据（等于 initPersona 做的事） */
        const pu = ctx.powerUserSettings;
        if (!pu.personas) pu.personas = {};
        pu.personas[id] = nm;
        if (!pu.persona_descriptions) pu.persona_descriptions = {};
        pu.persona_descriptions[id] = { description: String(desc || ''), position: 0, connections: [] };
        save();
        /* 通知酒馆（它会刷新自己的面具列表） */
        try { if (ctx.eventSource && ctx.eventTypes && ctx.eventTypes.PERSONA_CREATED) await ctx.eventSource.emit(ctx.eventTypes.PERSONA_CREATED, { avatarId: id, name: nm, description: String(desc || '') }); } catch (e) { }
        toast('已新建面具：' + nm, 'success');
        return id;
    } catch (e) {
        toast('创建失败：' + e.message, 'warning');
        return null;
    }
}

function orbPersonaHTML() {
    /* 绑定模式：正在给某个面具选角色 */
    if (orbBinding) return orbBindPickerHTML(orbBinding);
    /* 编辑模式：正在改某个面具的名称/描述 */
    if (orbPersonaEdit) return orbPersonaEditHTML(orbPersonaEdit);

    const list = orbPersonas();
    if (!list.length) {
        return '<div class="ssp-orb-empty">没读到面具。先在酒馆里打开一次「用户设定」面板，再回来看看。</div>'
            + '<div class="ssp-orb-foot"><span class="ssp-pbtn primary" data-orb-newpersona="1"><i class="fa-solid fa-plus"></i>新建面具</span></div>';
    }
    return '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-psearch="1" placeholder="搜角色卡 / 面具名 / 描述" value="' + esc(orbPSearch) + '">'
        + (orbPSearch ? '<span class="ssp-pbtn" data-orb-pclear="1">清除</span>' : '')
        + '</div>'
        + '<div id="ssp_orb_pfilter_list">' + orbPersonaRowsHTML() + '</div>'
        + '<div class="ssp-orb-foot"><span class="ssp-pbtn primary" data-orb-newpersona="1"><i class="fa-solid fa-plus"></i>新建面具</span></div>'
        + '<div class="ssp-orb-empty" style="padding-top:6px">搜角色卡名 → 列出**绑定了这张卡**的面具；也能搜面具名和描述。点「换成这个」换面具，「绑定」改绑定，「编辑」改名称/描述。</div>';
}

/** 一个面具是否命中搜索（角色卡名 / 面具名 / 描述 三处都算） */
function orbPersonaMatch(p, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    if (String(p.name || '').toLowerCase().indexOf(s) >= 0) return true;
    if (orbBindNames(p.id).toLowerCase().indexOf(s) >= 0) return true;
    if (orbPersonaDesc(p.id).toLowerCase().indexOf(s) >= 0) return true;
    return false;
}

/** 列表部分单独抽出来 —— 搜的时候只换这块，输入框不会丢焦点 */
function orbPersonaRowsHTML() {
    const all = orbPersonas();
    const act = orbActivePersona();
    const hit = all.filter(p => orbPersonaMatch(p, orbPSearch));
    if (!hit.length) {
        return '<div class="ssp-orb-empty">没有匹配「' + esc(orbPSearch) + '」的面具。<br>'
            + '（搜的是：角色卡名 / 面具名 / 描述）</div>';
    }
    const head = orbPSearch
        ? '<div class="ssp-orb-pcount">筛选出 ' + hit.length + ' / ' + all.length + ' 个面具</div>'
        : '';
    const rows = hit.map(p => {
        const on = (p.id === act);
        const bound = orbBindNames(p.id);
        const desc = orbPersonaDesc(p.id);
        return '<div class="ssp-orb-prow' + (on ? ' on' : '') + '">'
            + '<img class="ssp-orb-pav" src="' + orbPersonaThumb(p.id) + '" data-orb-persona="' + esc(p.id) + '" title="点头像换面具" alt="">'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(p.name) + (on ? '<span class="ssp-orb-ptag">当前</span>' : '') + '</div>'
            + '<div class="ssp-orb-pdesc">' + (desc ? esc(desc.slice(0, 80)) + (desc.length > 80 ? '…' : '') : '<i>没写描述</i>') + '</div>'
            + '<div class="ssp-orb-pbind' + (bound ? ' has' : '') + '"><i class="fa-solid fa-link"></i>' + (bound ? esc(bound) : '未绑定角色') + '</div>'
            + '</div>'
            + '<div class="ssp-orb-pacts">'
            + '<span class="ssp-pbtn' + (on ? ' primary' : '') + '" data-orb-persona="' + esc(p.id) + '">' + (on ? '当前' : '换成这个') + '</span>'
            + '<span class="ssp-pbtn" data-orb-bind="' + esc(p.id) + '"><i class="fa-solid fa-link"></i>绑定</span>'
            + '<span class="ssp-pbtn" data-orb-pedit="' + esc(p.id) + '"><i class="fa-solid fa-pen"></i>编辑</span>'
            + '</div></div>';
    }).join('');
    return head + '<div class="ssp-orb-plist">' + rows + '</div>';
}

/* ---------------------------- 面具的读取 / 编辑 ----------------------------
   名称：power_user.personas[面具id] = 字符串
   描述：power_user.persona_descriptions[面具id].description
   写：改上下文里的 live 对象 + saveSettingsDebounced()
   ------------------------------------------------------------------------ */
function orbPersonaDesc(id) {
    try {
        const d = (getContext().powerUserSettings || {}).persona_descriptions || {};
        return (d[id] && d[id].description) || '';
    } catch (e) { return ''; }
}

function orbPersonaSave(id, name, desc) {
    try {
        const pu = getContext().powerUserSettings;
        if (!pu) return false;
        if (!pu.personas) pu.personas = {};
        const nm = String(name || '').trim();
        if (nm) pu.personas[id] = nm;
        if (!pu.persona_descriptions) pu.persona_descriptions = {};
        if (!pu.persona_descriptions[id]) pu.persona_descriptions[id] = { connections: [] };
        pu.persona_descriptions[id].description = String(desc || '');
        save();
        /* 名字改了的话，顺手把酒馆自己列表里那一条的文字也改掉（不然要刷新才看到） */
        if (nm) {
            document.querySelectorAll('#user_avatar_block .avatar-container').forEach(c => {
                const img = c.querySelector('img');
                const m = img && /[?&]file=([^&]+)/.exec(img.getAttribute('src') || '');
                if (m && decodeURIComponent(m[1]) === id) {
                    const n = c.querySelector('.ch_name, b');
                    if (n) n.textContent = nm;
                }
            });
        }
        return true;
    } catch (e) { toast('保存失败：' + e.message, 'warning'); return false; }
}

function orbPersonaEditHTML(id) {
    const isNew = (id === '__new__');
    const p = isNew ? { name: '' } : (orbPersonas().find(x => x.id === id) || { name: id });
    return '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-pcancel="1"><i class="fa-solid fa-arrow-left"></i>返回</span>'
        + '<b>' + (isNew ? '新建面具' : '编辑面具 · ' + esc(p.name)) + '</b>'
        + '</div>'
        + '<div class="ssp-orb-fl"><span>名称</span>'
        + '<input class="ssp-inp" type="text" data-orb-pf="name" value="' + esc(p.name) + '" placeholder="面具名称（也就是 {{user}} 的名字）"></div>'
        + '<div class="ssp-orb-fl"><span>描述</span>'
        + '<textarea class="ssp-inp ssp-orb-ta" data-orb-pf="desc" rows="8" placeholder="这个面具的人设描述（会作为用户设定进提示词）">' + esc(isNew ? '' : orbPersonaDesc(id)) + '</textarea></div>'
        + '<div class="ssp-orb-edit-a">'
        + '<span class="ssp-pbtn primary" data-orb-psave="' + esc(id) + '"><i class="fa-solid fa-check"></i>' + (isNew ? '创建' : '保存') + '</span>'
        + '<span class="ssp-pbtn" data-orb-pcancel="1">取消</span>'
        + (isNew ? '<span class="ssp-pbtn" data-orb-pupload="1"><i class="fa-solid fa-image"></i>改用酒馆上传（自己选图）</span>' : '')
        + '</div>'
        + (isNew
            ? '<div class="ssp-orb-empty" style="padding-top:8px">直接填名字就能建 —— 头像先用一张自动生成的占位图（深色方块 + 名字首字），建完可以随时编辑；想用自己的图，点上面的「改用酒馆上传」。</div>'
            : '<div class="ssp-orb-empty" style="padding-top:8px">改的是酒馆原生的面具数据（名称 = 你说话时显示的名字；描述 = 用户设定内容），跟酒馆自己的面板互通。</div>');
}

/* ---------------------------- 面具 ↔ 角色 绑定 ----------------------------
   数据：power_user.persona_descriptions[面具id].connections = [{type:'character', id:'角色头像文件名'}]
   写：直接改上下文里的 live 对象 + saveSettingsDebounced()（实测可写可保存）。
   ------------------------------------------------------------------------ */
function orbCharList() {
    let c = [];
    try { c = (getContext() || {}).characters || []; } catch (e) { }
    return c.map(x => ({ id: x.avatar, name: x.name }));
}

function orbBindConns(id) {
    try {
        const d = (getContext().powerUserSettings || {}).persona_descriptions || {};
        const rec = d[id];
        if (!rec) return [];
        if (!Array.isArray(rec.connections)) rec.connections = [];
        return rec.connections;
    } catch (e) { return []; }
}

/** 绑定的角色名（逗号分隔，没绑定返回空串） */
function orbBindNames(id) {
    const chars = orbCharList();
    return orbBindConns(id).map(c => {
        const hit = chars.find(x => x.id === (c && c.id));
        return hit ? hit.name : (c && c.id) || '?';
    }).join('、');
}

function orbBindToggle(id, charId) {
    try {
        const d = getContext().powerUserSettings.persona_descriptions || {};
        if (!d[id]) d[id] = { description: '', position: 0, connections: [] };
        if (!Array.isArray(d[id].connections)) d[id].connections = [];
        const i = d[id].connections.findIndex(c => c && c.id === charId);
        if (i >= 0) d[id].connections.splice(i, 1);
        else d[id].connections.push({ type: 'character', id: charId });
        save();
        return i < 0;                                  // true = 新绑上
    } catch (e) { toast('绑定失败：' + e.message, 'warning'); return null; }
}

function orbBindClear(id) {
    try {
        const d = getContext().powerUserSettings.persona_descriptions || {};
        if (d[id]) { d[id].connections = []; save(); }
        return true;
    } catch (e) { return false; }
}

function orbBindPickerHTML(id) {
    const p = orbPersonas().find(x => x.id === id) || { name: id };
    const conns = orbBindConns(id).map(c => c && c.id);
    const chars = orbCharList();
    const rows = chars.length ? chars.map(c => {
        const on = conns.indexOf(c.id) >= 0;
        return '<div class="ssp-orb-charrow' + (on ? ' on' : '') + '" data-orb-bindchar="' + esc(c.id) + '">'
            + '<img src="/thumbnail?type=avatar&file=' + encodeURIComponent(c.id) + '" alt="">'
            + '<span class="ssp-orb-charn">' + esc(c.name) + '</span>'
            + '<span class="ssp-orb-charmark">' + (on ? '<i class="fa-solid fa-check"></i> 已绑定' : '<i class="fa-regular fa-circle"></i>') + '</span>'
            + '</div>';
    }).join('') : '<div class="ssp-orb-empty">没读到角色列表。</div>';
    return '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-bindback="1"><i class="fa-solid fa-arrow-left"></i>返回</span>'
        + '<b>' + esc(p.name) + ' · 绑定角色</b>'
        + '<span class="ssp-pbtn danger" data-orb-bindclear="' + esc(id) + '">清空</span>'
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">点角色＝绑定/取消；跟已绑定的角色聊天时，酒馆会自动戴上这个面具。</div>'
        + '<div class="ssp-orb-charrows">' + rows + '</div>';
}

function orbNotesHTML() {
    const list = orbNotes();
    if (!list.length) return '<div class="ssp-orb-empty">还没有番外。点下面的「＋ 新的一条」就能存了 —— 存好之后可以一键复制，或者直接插进输入框。</div>';
    return list.map(n => '<div class="ssp-orb-note" data-orb-note="' + esc(n.id) + '">'
        + '<div class="ssp-orb-note-h"><b>' + esc(n.title || '(没写标题)') + '</b>'
        + '<span class="ssp-orb-note-t">' + new Date(n.at || Date.now()).toLocaleDateString() + '</span></div>'
        + '<div class="ssp-orb-note-b">' + esc(String(n.text || '').slice(0, 160)) + (String(n.text || '').length > 160 ? '…' : '') + '</div>'
        + '<div class="ssp-orb-note-a">'
        + '<span class="ssp-pbtn" data-orb-act="copy" data-id="' + esc(n.id) + '"><i class="fa-solid fa-copy"></i>复制</span>'
        + '<span class="ssp-pbtn" data-orb-act="insert" data-id="' + esc(n.id) + '"><i class="fa-solid fa-arrow-right-to-bracket"></i>插进输入框</span>'
        + '<span class="ssp-pbtn" data-orb-act="edit" data-id="' + esc(n.id) + '"><i class="fa-solid fa-pen"></i>编辑</span>'
        + '<span class="ssp-pbtn danger" data-orb-act="del" data-id="' + esc(n.id) + '"><i class="fa-solid fa-trash"></i></span>'
        + '</div></div>').join('');
}

function orbPanelHTML() {
    const e = orbEditing;
    const cur = orbModule(orbTab) || ORB_MODULES[0];
    const tabs = ORB_MODULES.map(m => '<span class="ssp-orb-tab' + (m.id === cur.id ? ' on' : ' off')
        + '" data-orb-tab="' + m.id + '"><i class="fa-solid ' + m.icon + '"></i>' + esc(m.name) + '</span>').join('');
    return '<div class="ssp-orb-head"><span class="ssp-orb-logo"></span>'
        + '<div class="ssp-orb-title"><b>鼠鼠口袋</b><small>悬浮球 · ' + ORB_MODULES.length + ' 个模块</small></div>'
        + '<span class="ssp-pbtn" data-orb-close="1"><i class="fa-solid fa-xmark"></i></span></div>'
        + '<div class="ssp-orb-tabs">' + tabs + '</div>'
        + '<div class="ssp-orb-body">'
        + (e ? '<div class="ssp-orb-edit">'
            + '<input class="ssp-inp" type="text" data-orb-f="title" placeholder="标题（比如：番外·雨夜）" value="' + esc(e.title || '') + '">'
            + '<textarea class="ssp-inp ssp-orb-ta" data-orb-f="text" rows="9" placeholder="正文…">' + esc(e.text || '') + '</textarea>'
            + '<div class="ssp-orb-edit-a">'
            + '<span class="ssp-pbtn primary" data-orb-act="save" data-id="' + esc(e.id || '') + '"><i class="fa-solid fa-check"></i>保存</span>'
            + '<span class="ssp-pbtn" data-orb-act="cancel">取消</span>'
            + (e.id ? '<span class="ssp-pbtn danger" data-orb-act="del" data-id="' + esc(e.id) + '"><i class="fa-solid fa-trash"></i>删掉这条</span>' : '')
            + '</div></div>'
            : cur.render() + (cur.id === 'notes' ? '<div class="ssp-orb-foot"><span class="ssp-pbtn primary" data-orb-act="new"><i class="fa-solid fa-plus"></i>新的一条</span></div>' : ''))
        + '</div>';
}

/** 只换面板**内部**（绝不重画容器，否则球会被一起换掉） */
function renderOrbPanel() {
    const panel = document.getElementById('ssp_orb_panel');
    if (!panel) return false;
    panel.innerHTML = orbPanelHTML();
    refreshOrbBadge();
    return true;
}

function openOrb() {
    mountOrb();
    const root = document.getElementById('ssp_orb_root');
    if (root && root.classList) root.classList.add('on');
    orbOpenNow = true; orbEditing = null;
    renderOrbPanel();
    return true;
}

function closeOrb() {
    const root = document.getElementById('ssp_orb_root');
    if (root && root.classList) root.classList.remove('on');
    orbOpenNow = false; orbEditing = null;
    return true;
}

function refreshOrbBadge() {
    const b = document.getElementById('ssp_orb_badge');
    if (!b) return false;
    const n = orbNotes().length;
    b.textContent = n ? String(n) : '';
    b.style.display = n ? '' : 'none';
    return true;
}

function mountOrb() {
    if (orbBuilt && document.getElementById('ssp_orb')) return true;
    if (!document.body) return false;
    const oldBall = document.getElementById('ssp_orb'); if (oldBall) oldBall.remove();
    const oldRoot = document.getElementById('ssp_orb_root'); if (oldRoot) oldRoot.remove();

    /* 坐标存的是**离右边 / 下边的距离**（不是绝对像素）——
       这样窗口大小一变，球还能按同样的边距贴回去（用户要的"贴边、跟着窗口走"）。
       老数据是绝对 {x,y}，这里换算一次；算不出来就当没存过。 */
    let pos = getSettings().orbPos;
    if (pos && (typeof pos.right !== 'number' || typeof pos.bottom !== 'number')) {
        if (typeof pos.x === 'number' && typeof pos.y === 'number') {
            pos = { right: window.innerWidth - pos.x - 52, bottom: window.innerHeight - pos.y - 52 };
            if (pos.right < 0 || pos.bottom < 0) pos = null;
        } else {
            pos = null;
        }
    }
    orbEdge = pos ? { right: pos.right, bottom: pos.bottom } : { right: 18, bottom: 96 };

    /* ① 球：直接挂 body（不进任何容器） */
    const ball = document.createElement('div');
    ball.className = 'ssp-orb';
    ball.id = 'ssp_orb';
    ball.title = '鼠鼠口袋（可拖动 · 点一下展开）';
    /* ⚠️ 位置不能用 CSS 的 bottom：酒馆里球的包含块高度会被算成 0，
       bottom:96px 于是变成 top:-148px（球飞到屏幕外，用户以为没有球）。
       实测 left/right 正常、坏的只有纵向 → 直接按视口把 left/top 算好写进去。 */
    {
        const vs = 52;
        ball.setAttribute('style', 'left:' + Math.round(window.innerWidth - vs - orbEdge.right) + 'px;top:'
            + Math.round(window.innerHeight - vs - orbEdge.bottom) + 'px;right:auto;bottom:auto;');
    }
    ball.innerHTML = '<span class="ssp-orb-diamond"></span><span class="ssp-orb-badge" id="ssp_orb_badge"></span>';
    document.body.append(ball);

    /* ② 面板容器：全屏但 pointer-events:none，只让遮罩/面板收点击 */
    const root = document.createElement('div');
    root.id = 'ssp_orb_root';
    root.className = 'ssp-orb-root';
    root.innerHTML = '<div class="ssp-orb-mask" data-orb-close="1"></div>'
        + '<div class="ssp-orb-panel" id="ssp_orb_panel"></div>';
    document.body.append(root);

    orbBuilt = true;
    renderOrbPanel();
    refreshOrbBadge();
    return true;
}

function bindOrb() {
    if (bindOrb.done) return false;
    bindOrb.done = true;
    const getBall = () => document.getElementById('ssp_orb');
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;

    /* ⚠️ 实时同步：酒馆换面具/新建/改名/删面具、切聊天时，只要面板开着就跟着刷。
       之前是「换完立刻重画」→ 但酒馆那边的选中状态是异步落的，重画时读到的还是旧值，
       表现就是「必须关了再打开才看到变化」。挂事件才对。 */
    try {
        const c0 = getContext() || {};
        const es = c0.eventSource, et = c0.eventTypes;
        if (es && et && es.on) {
            ['PERSONA_CHANGED', 'PERSONA_CREATED', 'PERSONA_UPDATED', 'PERSONA_RENAMED', 'PERSONA_DELETED',
                'PRESET_CHANGED', 'OAI_PRESET_CHANGED_AFTER', 'PRESET_RENAMED', 'PRESET_DELETED', 'CHAT_CHANGED'].forEach(k => {
                const evName = et[k];
                if (!evName) return;
                es.on(evName, () => {
                    /* 切聊天时先看要不要自动换预设 / 自动换美化 */
                    if (k === 'CHAT_CHANGED') {
                        try { orbPresetAutoApply(); } catch (e) { }
                        try { orbThemeAutoApply(); } catch (e) { }
                    }
                    if (!orbOpenNow) return;
                    /* 刷两次：事件刚发时酒馆可能还没把选中状态落下来 */
                    setTimeout(() => { if (orbOpenNow) renderOrbPanel(); }, 60);
                    setTimeout(() => { if (orbOpenNow) renderOrbPanel(); }, 400);
                });
            });
            bindOrb.eventsBound = true;
        }
    } catch (e) { /* 事件拿不到就退回「点击后重画」 */ }

    /* 兜底：酒馆把自己列表的选中状态改了（.selected 变动），面板开着就跟着刷 */
    try {
        const ub = document.getElementById('user_avatar_block');
        if (ub && !bindOrb.observerBound && window.MutationObserver) {
            bindOrb.observerBound = true;
            new MutationObserver(() => {
                if (!orbOpenNow) return;
                if (orbTab !== 'persona' || orbBinding || orbPersonaEdit) return;
                renderOrbPanel();
            }).observe(ub, { attributes: true, attributeFilter: ['class'], subtree: true });
        }
    } catch (e) { }

    document.addEventListener('pointerdown', ev => {
        const el = ev.target && ev.target.closest ? ev.target.closest('#ssp_orb') : null;
        if (!el) return;
        const o = getBall(); if (!o) return;
        const r = o.getBoundingClientRect();
        dragging = true; moved = false;
        sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top;
        try { o.setPointerCapture(ev.pointerId); } catch (e) { }
    }, true);

    document.addEventListener('pointermove', ev => {
        if (!dragging) return;
        const o = getBall(); if (!o) return;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;      // 点一下别被当成拖动
        moved = true;
        const w = o.offsetWidth || 52, h = o.offsetHeight || 52;
        const x = Math.max(4, Math.min(window.innerWidth - w - 4, ox + dx));
        const y = Math.max(4, Math.min(window.innerHeight - h - 4, oy + dy));
        o.style.left = Math.round(x) + 'px'; o.style.top = Math.round(y) + 'px';
        o.style.right = 'auto'; o.style.bottom = 'auto';
        if (o.classList) o.classList.add('moving');
    }, true);

    document.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        const o = getBall(); if (!o) return;
        if (o.classList) o.classList.remove('moving');
        if (moved) {
            const r = o.getBoundingClientRect();
            orbEdge = { right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom) };
            getSettings().orbPos = { right: Math.max(0, orbEdge.right), bottom: Math.max(0, orbEdge.bottom) };
            save();
        } else if (orbOpenNow) closeOrb(); else openOrb();
    }, true);

    /* 面具页搜索：只换列表那一块（输入框不重画，焦点和光标都不会丢） */
    document.addEventListener('input', ev => {
        const el = ev.target;
        if (!el || !el.dataset || el.dataset.orbPsearch === undefined) return;
        orbPSearch = el.value || '';
        const box = document.getElementById('ssp_orb_pfilter_list');
        if (box) box.innerHTML = orbPersonaRowsHTML();
        /* 「清除」按钮跟着搜索词出现/消失（只补这一个节点，不动输入框） */
        const bar = document.querySelector('.ssp-orb-pfilter');
        if (bar) {
            let c = bar.querySelector('[data-orb-pclear]');
            if (orbPSearch && !c) {
                c = document.createElement('span');
                c.className = 'ssp-pbtn';
                c.setAttribute('data-orb-pclear', '1');
                c.textContent = '清除';
                bar.append(c);
            } else if (!orbPSearch && c) {
                c.remove();
            }
        }
    });

    /* 存档页搜索 */
    document.addEventListener('input', ev => {
        const el = ev.target;
        if (!el || !el.dataset || el.dataset.orbChsearch === undefined) return;
        orbChSearch = el.value || '';
        const box = document.getElementById('ssp_orb_chat_list');
        if (box) box.innerHTML = orbChatRowsHTML();
    });

    /* 美化页搜索 */
    document.addEventListener('input', ev => {
        const el = ev.target;
        if (!el || !el.dataset || el.dataset.orbThsearch === undefined) return;
        orbThSearch = el.value || '';
        const box = document.getElementById('ssp_orb_theme_list');
        if (box) box.innerHTML = orbThemeRowsHTML();
        const bar = document.querySelector('.ssp-orb-pfilter');
        if (bar) {
            let c = bar.querySelector('[data-orb-thclear]');
            if (orbThSearch && !c) { c = document.createElement('span'); c.className = 'ssp-pbtn'; c.setAttribute('data-orb-thclear', '1'); c.textContent = '清除'; bar.append(c); }
            else if (!orbThSearch && c) c.remove();
        }
    });

    /* 预设页搜索 */
    document.addEventListener('input', ev => {
        const el = ev.target;
        if (!el || !el.dataset || el.dataset.orbPresearch === undefined) return;
        orbPreSearch = el.value || '';
        const box = document.getElementById('ssp_orb_preset_list');
        if (box) box.innerHTML = orbPresetRowsHTML();
        const bar = document.querySelector('.ssp-orb-pfilter');
        if (bar) {
            let c = bar.querySelector('[data-orb-preclear]');
            if (orbPreSearch && !c) { c = document.createElement('span'); c.className = 'ssp-pbtn'; c.setAttribute('data-orb-preclear', '1'); c.textContent = '清除'; bar.append(c); }
            else if (!orbPreSearch && c) c.remove();
        }
    });

    document.addEventListener('click', ev => {
        const t = ev.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-orb-pclear]')) { orbPSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-close]')) { closeOrb(); return; }
        /* 美化页：清除搜索 / 返回 / 用这个 / 绑定 / 选角色 / 自动开关 */
        if (t.closest('[data-orb-thclear]')) { orbThSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-themeback]')) { orbThemeBinding = null; renderOrbPanel(); return; }
        const thm = t.closest('[data-orb-theme]');
        if (thm) { const n = thm.dataset.orbTheme; if (orbThemePick(n)) { toast('已换成美化：' + n, 'success'); renderOrbPanel(); } return; }
        const tbind = t.closest('[data-orb-tbind]');
        if (tbind) { orbThemeBinding = tbind.dataset.orbTbind; renderOrbPanel(); return; }
        const tbc = t.closest('[data-orb-tbindchar]');
        if (tbc) {
            const charId = tbc.dataset.orbTbindchar, tname = tbc.dataset.orbTbindname;
            const tb = orbThemeBinds();
            orbThemeBind(charId, tb[charId] === tname ? '' : tname);
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-thauto]')) {
            getSettings().themeAuto = Boolean(t.checked);
            save();
            toast(t.checked ? '自动换美化：开' : '自动换美化：关', 'info');
            return;
        }
        /* 预设页：清除搜索 / 返回 / 用这个 / 绑定 / 选角色 / 自动开关 */        if (t.closest('[data-orb-preclear]')) { orbPreSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-presetback]')) { orbPresetBinding = null; renderOrbPanel(); return; }
        const prs = t.closest('[data-orb-preset]');
        if (prs) { const n = prs.dataset.orbPreset; if (orbPresetPick(n)) { toast('已换成预设：' + n, 'success'); renderOrbPanel(); } return; }
        const pbind = t.closest('[data-orb-pbind]');
        if (pbind) { orbPresetBinding = pbind.dataset.orbPbind; renderOrbPanel(); return; }
        const pbc = t.closest('[data-orb-pbindchar]');
        if (pbc) {
            const charId = pbc.dataset.orbPbindchar, pname = pbc.dataset.orbPbindname;
            const bb = orbPresetBinds();
            orbPresetBind(charId, bb[charId] === pname ? '' : pname);
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-pauto]')) {
            getSettings().presetAuto = Boolean(t.checked);
            save();
            toast(t.checked ? '自动换预设：开' : '自动换预设：关', 'info');
            return;
        }
        /* 模块标签页 */
        const tabEl = t.closest('[data-orb-tab]');
        if (tabEl) {
            orbTab = tabEl.dataset.orbTab || 'notes'; orbEditing = null;
            renderOrbPanel();
            if (orbTab === 'chat') orbChatsFetch();            // 存档页：打开就拉一次列表
            return;
        }
        /* 存档页：刷新 / 读档 / 删除 / 清除搜索 */
        if (t.closest('[data-orb-chrefresh]')) { orbChatsFetch(); return; }
        if (t.closest('[data-orb-chclear]')) { orbChSearch = ''; renderOrbPanel(); return; }
        const cren = t.closest('[data-orb-chatren]');
        if (cren) {
            const file = cren.dataset.orbChatren, nm = cren.dataset.orbChatname || file;
            getContext().callGenericPopup('把存档「' + nm + '」改成什么名字？<br><i style="opacity:.6">（酒馆会自动清洗掉文件名里的非法字符）</i>',
                getContext().POPUP_TYPE.INPUT, nm, { okButton: '改名', cancelButton: '取消' })
                .then(r => {
                    const val = (typeof r === 'string') ? r : '';
                    if (val && val.trim() && val.trim() !== nm) orbChatRename(file, val.trim());
                });
            return;
        }
        const cload = t.closest('[data-orb-chatload]');
        if (cload) { orbChatLoad(cload.dataset.orbChatload); return; }
        const cdel = t.closest('[data-orb-chatdel]');
        if (cdel) {
            const file = cdel.dataset.orbChatdel, nm = cdel.dataset.orbChatname || file;
            getContext().callGenericPopup('删掉存档「' + nm + '」？<br>删了就找不回来了。', getContext().POPUP_TYPE.CONFIRM, '', {
                okButton: '删掉', cancelButton: '算了',
            }).then(r => { if (r === getContext().POPUP_RESULT.AFFIRMATIVE) orbChatDelete(file); });
            return;
        }
        /* 面具栏：编辑 / 选一个 / 新建 / 绑定角色 */
        if (t.closest('[data-orb-pcancel]')) { orbPersonaEdit = null; renderOrbPanel(); return; }
        const pedit = t.closest('[data-orb-pedit]');
        if (pedit) { orbPersonaEdit = pedit.dataset.orbPedit; orbBinding = null; renderOrbPanel(); return; }
        const psave = t.closest('[data-orb-psave]');
        if (psave) {
            const pn = document.getElementById('ssp_orb_panel');
            const nEl = pn && pn.querySelector('[data-orb-pf="name"]');
            const dEl = pn && pn.querySelector('[data-orb-pf="desc"]');
            const pid = psave.dataset.orbPsave;
            const pname = nEl ? nEl.value : '';
            const pdesc = dEl ? dEl.value : '';
            if (pid === '__new__') {
                /* 新建：生成占位图 → 走酒馆上传接口 → 建完直接进编辑 */
                if (!String(pname).trim()) { toast('先起个名字', 'warning'); return; }
                orbPersonaCreate(pname, pdesc).then(newId => {
                    if (!newId) return;
                    orbPersonaEdit = newId;
                    renderOrbPanel();
                });
                return;
            }
            if (orbPersonaSave(pid, pname, pdesc)) {
                orbPersonaEdit = null; renderOrbPanel(); toast('面具已保存', 'success');
            }
            return;
        }
        /* 新建时改用酒馆自己的上传（想自己选图） */
        if (t.closest('[data-orb-pupload]')) {
            const b = document.getElementById('add_avatar_button');
            if (b) { b.click(); orbPersonaEdit = null; renderOrbPanel(); }
            else toast('没找到酒馆的上传按钮', 'warning');
            return;
        }
        if (t.closest('[data-orb-bindback]')) { orbBinding = null; renderOrbPanel(); return; }
        const bindBtn = t.closest('[data-orb-bind]');
        if (bindBtn) { orbBinding = bindBtn.dataset.orbBind; renderOrbPanel(); return; }
        const bindChar = t.closest('[data-orb-bindchar]');
        if (bindChar && orbBinding) { orbBindToggle(orbBinding, bindChar.dataset.orbBindchar); renderOrbPanel(); return; }
        const bindClear = t.closest('[data-orb-bindclear]');
        if (bindClear) { orbBindClear(bindClear.dataset.orbBindclear); toast('已清空绑定', 'info'); renderOrbPanel(); return; }
        const face = t.closest('[data-orb-persona]');
        if (face) { orbPersonaSwitch(face.dataset.orbPersona); renderOrbPanel(); return; }
        if (t.closest('[data-orb-newpersona]')) { orbPersonaNew(); return; }
        const act = t.closest('[data-orb-act]');
        if (!act) return;
        const a = act.dataset.orbAct, id = act.dataset.id || '';
        const panel = document.getElementById('ssp_orb_panel');
        const val = f => { const el = panel && panel.querySelector('[data-orb-f="' + f + '"]'); return el ? el.value : ''; };
        if (a === 'new') { orbEditing = { id: '', title: '', text: '' }; renderOrbPanel(); const f = panel.querySelector('[data-orb-f="title"]'); if (f) f.focus(); return; }
        if (a === 'cancel') { orbEditing = null; renderOrbPanel(); return; }
        if (a === 'save') {
            const rec = orbSaveNote(id, val('title'), val('text'));
            orbEditing = null; renderOrbPanel();
            toast(rec ? '已存下这一条' : '空的没存（标题或正文写一个）', rec ? 'success' : 'warning');
            return;
        }
        if (a === 'edit') { const n = orbNotes().find(x => x.id === id); if (n) { orbEditing = { id: n.id, title: n.title, text: n.text }; renderOrbPanel(); } return; }
        if (a === 'del') { if (orbDelNote(id)) { orbEditing = null; renderOrbPanel(); toast('删掉了', 'info'); } return; }
        if (a === 'copy') { const n = orbNotes().find(x => x.id === id); if (n) orbCopy((n.title ? n.title + '\n\n' : '') + n.text).then(ok => toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'warning')); return; }
        if (a === 'insert') { const n = orbNotes().find(x => x.id === id); if (n) orbInsert((n.title ? n.title + '\n\n' : '') + n.text); return; }
    }, true);

    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && orbOpenNow) closeOrb(); });

    /* ⚠️ 窗口大小变化时，按「离边距离」重算位置 ——
       这就是用户要的"窗口缩小，球跟着贴边走"。以前存绝对像素，一缩窗口球就脱边/跑出屏幕。 */
    if (!bindOrb.resizeBound) {
        bindOrb.resizeBound = true;
        window.addEventListener('resize', () => {
            const o = getBall();
            if (!o) return;
            const w = o.offsetWidth || 52, h = o.offsetHeight || 52;
            const right = Math.max(4, Math.min(window.innerWidth - w - 4, orbEdge.right));
            const bottom = Math.max(4, Math.min(window.innerHeight - h - 4, orbEdge.bottom));
            o.style.left = Math.round(window.innerWidth - w - right) + 'px';
            o.style.top = Math.round(window.innerHeight - h - bottom) + 'px';
            o.style.right = 'auto'; o.style.bottom = 'auto';
        });
    }
    return true;
}


function init() {
    const ctx = getContext();
    if (!ctx) { warn('拿不到 getContext()，扩展不启动'); return false; }
    getSettings();

    let tries = 0;
    const boot = () => {
        const mountOk = Boolean(ensureMount());
        const drawerOk = mountDrawer();
    mountSettingsPanel();                                        // 扁平设置面板（点抽屉里的按钮打开）
    bindSettingsOnce();
        if ((!mountOk || !drawerOk) && tries < 40) { tries += 1; globalThis.setTimeout?.(boot, 250); }
    };
    boot();
    apply();
    applyCardStyle();
    applyCardOrder();
    trimListCreatorNotes();
    document.addEventListener?.('click', blockCardClick, true);   // 排序模式下别让点卡片打开角色
    document.addEventListener?.('pointerdown', onListPointerDown, true);
    bindFavStar();                                               // 列表卡片上的 ★ 能点（收藏/取消收藏）
    if (importMergeOn()) bindImportMerge();                      // 导入即更新（合并 导入 / 替换 / URL导入）
    registerThinkDisplayHook();                                  // 思维链收纳：显示层兜底（流式半截标签也不上屏）
    registerThinkEvents();                                       // 思维链收纳：生成结束/收到消息/换聊天时收纳
    if (getSettings().orbOn !== false) { mountOrb(); bindOrb(); }   // 🐭 悬浮球（鼠鼠口袋）

    try {
        ctx.eventSource?.on?.(ctx.eventTypes?.CHARACTER_PAGE_LOADED, () => reclaim('page-loaded'));
        ctx.eventSource?.on?.(ctx.eventTypes?.CHARACTER_EDITOR_OPENED, () => reclaim('editor-opened'));
        ctx.eventSource?.on?.(ctx.eventTypes?.CHAT_CHANGED, () => reclaim('chat-changed'));
        ctx.eventSource?.on?.(ctx.eventTypes?.APP_READY, () => { ensureMount(); mountDrawer(); reclaim('app-ready'); });
    } catch (e) { warn('事件挂载失败', e); }

    log('v0.3.0 已加载（' + activeDevice() + '）');
    return true;
}

const started = init();

/* 离线测试钩子 —— 生产环境不生效 */
if (globalThis.__SSP_TEST__) {
    globalThis.__SSP_TEST_API = {
        MODULE_NAME, BUTTONS, ZONES, ZONE_IDS, MOUNT_ID, BOX_ID, TOGGLE_ID, ZONE_PREFIX, ALIGNS, ALIGN_CSS, SCHEMA_VERSION,
        defaultLayout, getSettings, apply, restoreAll, reclaim,
        ensureMount, ensureZoneEls, ensureModuleEls, placeModules, renderMount,
        putButton, toggleRow, setLayers, setAlign, addModule, delModule, renameModule,
        moveModule, moveModuleToOtherZone, locateButton, zoneOfModule, currentLayout, normalizeLayout,
        activeDevice, snapshots, claimed, modEls, zoneEls, hideStyle, elCache, resolveNative, newEls,
        ensureNewBtnEls, ACTIONS, sortByField, clickTagAction, pickRandomCharacter, libraryStats, showLibraryStats,
        CARD_STYLES, CARD_STYLE_ORDER, CARD_STYLE_ID, CARD_OPT, setCardAvatarVars, cardAvatarOf, cardEls, cardOrderSettings,
        applyCardOrder, saveCardOrder, clearCardOrder, setSortMode, onListPointerDown, blockCardClick,
        startCardDrag, moveCardDrag, endCardDrag, reorderByPointer, insertSortHint, removeSortHint,
        get sortMode() { return sortMode; }, CARD_DEFAULTS, CARD_STYLE_META, CARD_ID_THEMES, CARD_POSTER_STYLES, CARD_KNOBS, cardGridNeutralCSS, cardTouchCSS, measureCards, cardStyleSettings, touchBegin, touchMove, touchEnd, touchCancel, tapSelect, tapDropTo, onMountPointerDown, guardTouchScroll, fakeDropEvent, cardVarsCSS, switchCardStyle,
        cardAssembleCSS, applyCardStyle, setCardColor, cardAvatarFile, toggleCardFav, onFavStarClick, bindFavStar,
        detailEnabled, detailFieldPairs, detailAboutBlock, detailCurrentChar, applyDetailHeader, restoreDetailHeader, DETAIL_FLAG, mkel,
        applyTagTools, openTagInput, closeTagInput, tagInputRow, DETAIL_CSS, VIDEO_CSS,
        detailStyle, buildVideoBlocks, syncVideoFav, buildVideoTopbar,
        importMergeOn, importNorm, importNameFromFile, importCardName, importCardData, importFindMatch, importPost,
        importRefresh, importTagsOf, importAsk, importHandleFile, onImportFileChange, onUrlImportClick,
        bindImportMerge, restoreImportMerge, importMatchReason, importTextSim, importSimThreshold, IMPORT_SIM_DEFAULT,
        importSnapshotExtras, importRestoreExtras,
        extractThinking, applyThinkingShield, thinkTags, registerThinkDisplayHook, registerThinkEvents,
        migrateTweaksSettings, TWEAKS_MODULE_NAME,
        restoreCardStyle, hdCardAvatars, cardDrawerHTML, mountDrawer, attrOf, setAttr,
        mountOrb, bindOrb, openOrb, closeOrb, orbNotes, orbSaveNote, orbDelNote, orbInsert, orbCopy, refreshOrbBadge, ORB_MODULES, orbModule,
        mountSettingsPanel, openSettingsPanel, closeSettingsPanel, panelOpen, settingsPanelHTML, bindSettings, refreshCardSection, trimListCreatorNotes,
        get boxOpen() { return boxOpen; }, set boxOpen(v) { boxOpen = v; },
        get renaming() { return renaming; }, set renaming(v) { renaming = v; },
        get drag() { return drag; }, set drag(v) { drag = v; },
        onMountClick, onMountChange, onMountDragStart, onMountDrop, editorHTML, started,
    };
}
