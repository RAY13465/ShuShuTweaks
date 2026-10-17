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
/* 第一张卡不许吃这个负边距 —— 否则它会被顶到列表可视区外面，叠压程度越大越看不见
   （用户反馈的"叠层相册第一张卡被压得差不多没了"就是这个）。
   ⚠️ 不能用 :first-child：列表里第一张卡前面还可能有分组 / 文件夹这类同辈元素
   （.group_select / .bogus_folder_select 跟 .character_select 是并列的），
   :first-child 根本不命中它。这里用「类内第一张」＝前面没有任何 .character_select 同辈。 */
#rm_print_characters_block .character_select:not(.character_select ~ .character_select){ margin-top:0; }
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
    /* 后几项只给「这次更新会改什么」那张清单用，不参与认卡（认卡只看 name/description/personality） */
    const out = {
        name: '', description: '', personality: '',
        scenario: '', first_mes: '', mes_example: '', creator_notes: '', tags: '', world: '', regexCount: 0,
        character_book: null, thScripts: 0, regex_scripts: [],
    };
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
            /* 清单用的那几项（读不到就是空串，清单会自己跳过） */
            const g = k => String(d[k] != null ? d[k] : (json[k] != null ? json[k] : '')).trim();
            out.scenario = g('scenario');
            out.first_mes = g('first_mes');
            out.mes_example = g('mes_example');
            out.creator_notes = g('creator_notes') || g('creatorcomment');
            const tg = Array.isArray(d.tags) ? d.tags : (Array.isArray(json.tags) ? json.tags : []);
            out.tags = tg.map(x => String(x)).join('、');
            const dx = (d.extensions && typeof d.extensions === 'object') ? d.extensions : {};
            out.world = String(dx.world || '').trim();
            out.regexCount = Array.isArray(dx.regex_scripts) ? dx.regex_scripts.length : 0;
            /* 卡里内嵌的世界书（V2/V3 的 character_book）—— 导入时酒馆不会把它落成世界书，
               得我们自己补（见 importEmbeddedBook 的注释） */
            out.character_book = (d.character_book && typeof d.character_book === 'object') ? d.character_book : null;
            /* 酒馆助手（TavernHelper）脚本：卡里内嵌的那种，条数给清单比对用 */
            out.thScripts = (dx.tavern_helper && Array.isArray(dx.tavern_helper.scripts)) ? dx.tavern_helper.scripts.length : 0;
            /* 局部正则原样带回（清单要对比"代码有没有改"，光比条数看不出来） */
            out.regex_scripts = Array.isArray(dx.regex_scripts) ? dx.regex_scripts : [];
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

/** 「这次更新会改什么」—— 新旧卡逐项比一遍，做成一张清单塞进确认弹窗。
    原则：只说人看得懂的事，不堆数据。
      · 文字字段：没变 / 改了（字数前后）/ 新增 / 会被清空
      · 世界书绑定：按「新卡没绑就用旧的兜住，新卡绑了听新卡的」直接写结果
      · 本地正则：新卡带了几条、旧的会不会补回
      · 收藏：你是收藏就保留
    读不出内容的新卡（解析挂了）返回空串 —— 宁可不显示，也不能把"没读出来"说成"会被清空"。 */
function importDiffHTML(newCard, oldChar) {
    const n = newCard || {};
    const o = oldChar || {};
    const oe = (o.data && o.data.extensions) || {};
    const readable = !!(n.description || n.personality || n.first_mes || n.scenario || n.mes_example);
    if (!readable) return '<p style="opacity:.6;font-size:.88em;margin:8px 0 2px">这张卡的内容没读出来，列不出改动清单。</p>';
    const len = v => String(v == null ? '' : v).replace(/\s+/g, '').length;
    const rows = [];
    const TEXT = [
        ['姓名', o.name, n.name],
        ['简介', o.description, n.description],
        ['人设', o.personality, n.personality],
        ['场景', o.scenario, n.scenario],
        ['开场白', o.first_mes, n.first_mes],
        ['示例对话', o.mes_example, n.mes_example],
        ['作者备注', o.creatorcomment || o.creator_notes, n.creator_notes],
    ];
    TEXT.forEach(pair => {
        const label = pair[0], a = pair[1], b = pair[2];
        const la = len(a), lb = len(b);
        if (String(a == null ? '' : a) === String(b == null ? '' : b)) { rows.push([label, '没变', '']); return; }
        if (!lb && la) { rows.push([label, '会被清空', la + ' 字 → 空']); return; }
        if (!la && lb) { rows.push([label, '新增', lb + ' 字']); return; }
        const d = lb - la;
        rows.push([label, '改了', la + ' → ' + lb + ' 字（' + (d > 0 ? '+' : '') + d + '）']);
    });
    /* 世界书绑定：第 2 列只放短结论，长的解释一律丢第 3 列 ——
       不然这一列会被撑宽，上面几行的字数变化全被推到很右边，看着像两截。 */
    const ow = String(oe.world || '').trim(), nw = String(n.world || '').trim();
    if (ow !== nw) {
        if (!nw) rows.push(['世界书绑定', '保留你的', '新卡没绑 → 仍用《' + ow + '》']);
        else if (!ow) rows.push(['世界书绑定', '新卡绑了', '《' + nw + '》']);
        else rows.push(['世界书绑定', '换成', '《' + nw + '》']);
    } else {
        rows.push(['世界书绑定', '没变', ow ? '《' + ow + '》' : '都没绑']);
    }
    /* 卡里内嵌的世界书：**绑定名字没变 ≠ 书没变** —— 条目数一比就看出来了。
       （用户反馈："我明明新加了世界书条目，更新时非要和我说没变" —— 上一版只比了绑定名字，
        内嵌书的正文压根没看，所以显示'没变'是误导。） */
    const ob = (o.data && o.data.character_book) || null;
    const nb = (n.character_book) || null;
    const oen = ob && Array.isArray(ob.entries) ? ob.entries.length : 0;
    const nen = nb && Array.isArray(nb.entries) ? nb.entries.length : 0;
    if (oen || nen) {
        /* 光看条数不够 —— 条目**内容/设置**改了也要说（用户要求：变了就得更新） */
        const bsig = b => (b && Array.isArray(b.entries)
            ? b.entries.map(e => [String((e && e.content) || '').length, !!e.constant, !!e.selective, Number(e.position) || 0, Number(e.insertion_order) || 0, !!e.enabled].join(':')).join('|')
            : '');
        const bodyChanged = bsig(ob) !== bsig(nb);
        rows.push(['内嵌世界书',
            (nen === oen ? '条数没变' : (nen > oen ? '加了条目' : '少了条目')) + (bodyChanged ? '，内容/设置有改动' : ''),
            oen + ' → ' + nen + ' 条']);
    }
    /* 局部正则：**代码**变了也要说（只比条数是看不出来的）*/
    const orx = Array.isArray(oe.regex_scripts) ? oe.regex_scripts : [];
    const nrx = Array.isArray(n.regex_scripts) ? n.regex_scripts : [];
    if (orx.length || nrx.length) {
        const keyOf = s => String((s && (s.id || s.scriptName || s.name)) || '');
        const codeOf = s => String((s && (s.replaceString || s.findRegex || s.scriptName || '')) || '');
        const oldMap = new Map(orx.map(s => [keyOf(s), codeOf(s)]));
        let rxAdd = 0, rxChg = 0;
        nrx.forEach(s => {
            if (!oldMap.has(keyOf(s))) { rxAdd += 1; return; }
            if (oldMap.get(keyOf(s)) !== codeOf(s)) rxChg += 1;
        });
        const bits = [];
        if (rxAdd) bits.push('新 ' + rxAdd + ' 条');
        if (rxChg) bits.push('代码改了 ' + rxChg + ' 条');
        rows.push(['局部正则', bits.length ? bits.join('，') : '没变', orx.length + ' → ' + nrx.length + ' 条']);
    }
    /* 酒馆助手脚本（卡里内嵌的 TavernHelper scripts）：条数变了要说。
       旧卡那份从 live 角色对象里读（跟内嵌世界书一个路子），新卡那份由 importCardData 带回来。 */
    const oTh = (o.data && o.data.extensions && o.data.extensions.tavern_helper
        && Array.isArray(o.data.extensions.tavern_helper.scripts)) ? o.data.extensions.tavern_helper.scripts.length : 0;
    const nTh = typeof n.thScripts === 'number' ? n.thScripts : 0;
    if (oTh || nTh) rows.push(['酒馆助手脚本', oTh === nTh ? '没变' : (nTh > oTh ? '加了脚本' : '少了脚本'), oTh + ' → ' + nTh + ' 个']);
    /* 本地正则：新卡带的 + 旧的不丢 */
    const orc = Array.isArray(oe.regex_scripts) ? oe.regex_scripts.length : 0;
    const nrc = Number(n.regexCount || 0);
    if (nrc === orc) rows.push(['本地正则', '没变', orc + ' 条']);
    else if (!nrc) rows.push(['本地正则', '补回', '新卡 0 条 → 旧的 ' + orc + ' 条补回']);
    else if (!orc) rows.push(['本地正则', '新增', '新卡带了 ' + nrc + ' 条']);
    else rows.push(['本地正则', '合并', orc + ' → ' + nrc + ' 条，旧的缺的补回']);
    if (o.fav === true || oe.fav === true || oe.fav === 'true') rows.push(['收藏 ★', '保留', '']);
    const tr = rows.map(r => '<tr><td style="padding:2px 10px 2px 0;opacity:.7;white-space:nowrap">' + esc(r[0]) + '</td>'
        + '<td style="padding:2px 10px 2px 0">' + esc(r[1]) + '</td>'
        + '<td style="padding:2px 0;opacity:.55;font-size:.9em">' + esc(r[2]) + '</td></tr>').join('');
    return '<div style="margin:10px 0 4px;text-align:left">'
        + '<div style="font-size:.9em;opacity:.8;margin-bottom:3px">这次更新会改这些'
        + '<span style="opacity:.7">（选「另存为新角色」则库里那张不动）</span>：</div>'
        + '<table style="border-collapse:collapse;font-size:.92em">' + tr + '</table></div>';
}

/** 弹一次确认：更新 / 另存为新角色 / 取消
    ⚠️ callGenericPopup 是 (内容, 类型, 输入框默认值, 选项) 四个参数 —— 选项写到第 3 个会被无视，
       自定义按钮就不见了、退化成系统默认的「确定 / 否」。POPUP_RESULT.CUSTOM1/2 = 1001/1002。 */
async function importAsk(cardName, existingName, reason, sameName, newCard, oldChar) {
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
        ${newCard ? importDiffHTML(newCard, oldChar) : ''}
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
/** 卡里内嵌的世界书（V2/V3 的 `data.character_book`）→ 酒馆的世界书格式。
    为什么必须自己补这一步（实测过源码，不是猜）：酒馆只在**导出**卡的时候把世界书转成
    character_book（`src/endpoints/characters.js` 的 `convertWorldInfoToCharacterBook`），
    **导入时不会反向落成世界书** —— 全 `src` 搜 `character_book` 只有导出/校验/默认卡三处。
    所以"更新角色卡"永远带不上卡里那本内嵌世界书（用户反馈的正是这个）。
    书名照酒馆导出时的对应关系取卡自带的 `extensions.world`，没有就退回内嵌书自己的名字、再退回角色名。 */
function importEmbeddedBook(cardData, charName) {
    const d = (cardData && cardData.data && typeof cardData.data === 'object') ? cardData.data : (cardData || {});
    const cb = d && d.character_book;
    if (!cb || !Array.isArray(cb.entries) || !cb.entries.length) return null;
    const ext = (d.extensions && typeof d.extensions === 'object') ? d.extensions : {};
    const name = String(ext.world || cb.name || charName || '').trim();
    if (!name) return null;
    const entries = {};
    cb.entries.forEach((e, i) => {
        if (!e) return;
        const uid = Number.isFinite(Number(e.id)) ? Number(e.id) : i;
        const pos = Number(e.position);
        entries[String(uid)] = {
            uid: uid,
            key: Array.isArray(e.keys) ? e.keys.map(String) : [],
            keysecondary: Array.isArray(e.secondary_keys) ? e.secondary_keys.map(String) : [],
            comment: String(e.comment || e.name || ''),
            content: String(e.content || ''),
            constant: !!e.constant,
            vectorized: false,
            selective: !!e.selective && Array.isArray(e.secondary_keys) && e.secondary_keys.length > 0,
            selectiveLogic: 0,
            addMemo: true,
            order: Number.isFinite(Number(e.insertion_order)) ? Number(e.insertion_order) : 100,
            position: Number.isFinite(pos) && pos >= 0 && pos <= 4 ? pos : 0,
            disable: e.enabled === false,
            excludeRecursion: false, preventRecursion: false, delayUntilRecursion: 0,
            probability: 100, useProbability: true, depth: 4,
            group: '', groupOverride: false, groupWeight: 100, scanDepth: null,
            caseSensitive: !!e.case_sensitive, matchWholeWords: null, useGroupScoring: null,
            automationId: '', role: null, sticky: 0, cooldown: 0, delay: 0,
            displayIndex: i,
        };
    });
    return { name: name, entries: entries };
}

/** 更新卡时：把卡里内嵌的世界书写进 worlds/<书名>.json。
    ⚠️ 已有的书**条目更多就不覆盖**（多半是你自己加过东西）——
       宁可不动、并在提示里说清，也不静默清掉你的编辑。 */
async function importWriteEmbeddedBook(card, charName) {
    const emb = importEmbeddedBook(card, charName);
    if (!emb) return null;
    const hdrs = () => { const c = getContext() || {}; return Object.assign({ 'Content-Type': 'application/json' }, c.getRequestHeaders ? c.getRequestHeaders() : {}); };
    let cur = null;
    try { cur = await orbDataPost('/api/worldinfo/get', { name: emb.name }); } catch (e) { }
    const curN = cur && cur.entries ? Object.keys(cur.entries).length : 0;
    const newN = Object.keys(emb.entries).length;
    if (curN > newN) {
        toast('卡里内嵌的世界书《' + emb.name + '》已存在且条目更多（' + curN + ' > ' + newN + ' 条），没覆盖 —— 想用卡里那版就先在酒馆里删掉这本', 'warning');
        return { name: emb.name, skipped: true, curN: curN, newN: newN };
    }
    try {
        const r = await fetch('/api/worldinfo/edit', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name: emb.name, data: { entries: emb.entries } }), cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        toast('卡里内嵌的世界书已写入《' + emb.name + '》（' + newN + ' 条）', 'success');
        try { if (typeof updateWorldInfoList === 'function') await updateWorldInfoList(); } catch (e) { }
        return { name: emb.name, wrote: newN };
    } catch (e) {
        toast('内嵌世界书写入失败：' + ((e && e.message) || e), 'warning');
        return { name: emb.name, error: String((e && e.message) || e) };
    }
}

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
            importMatchReason(file, cardName, cardDesc, cardPers, match), !!sameName, card, match);
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
    /* ⚠️ 更新完必须**把世界书重新套一遍**（用户反馈："更新了角色卡，世界书好像还是没看到更新"）。
       原因：套用只在「切聊天 / 切角色」时跑，而更新**同一张卡**不触发切换，
       还被"同一张卡只套一次"的锁挡着 → 绑定的书不会重新生效。
       两件事一起做：
         ① 解开那把锁，按本扩展的绑定重新对齐一遍（v1.31.20 之后顺带会撤掉不属于这张卡的书）
         ② 卡自己带的 world（酒馆原生那本）如果没生效，也补上 —— 那是随卡更新的，
            不补的话"新版本换了世界书"根本看不出来 */
    if (target) {
        try {
            const ctx = getContext() || {};
            const wkey = orbWbChatKey();
            if (wkey) orbWbAutoArmed.delete(wkey);
            await orbWbApplyForChar();
            /* 卡自己的 world：从刚更新完的角色表里读（前面 restore 已经 getCharacters 过一次） */
            try { if (typeof ctx.getCharacters === 'function') await ctx.getCharacters(); } catch (e) { }
            const me = (ctx.characters || [])[ctx.characterId];
            const nativeWorld = String((me && me.data && me.data.extensions && me.data.extensions.world) || '').trim();
            if (nativeWorld) {
                const sel = document.getElementById('world_info');
                const opts = sel ? Array.from(sel.options || []) : [];
                const hit = opts.some(o => (o.textContent || '').trim() === nativeWorld && o.selected);
                if (!hit && opts.some(o => (o.textContent || '').trim() === nativeWorld)) {
                    orbWbSelApply([nativeWorld], []);
                    toast('这张卡自带的世界书已生效：' + nativeWorld, 'info');
                }
            }
            /* ③ 卡里**内嵌**的世界书（character_book）：酒馆导入时不会落成世界书，
                  这里替它写一份（新卡换了内嵌内容时，这一步才带得上） */
            const embRes = await importWriteEmbeddedBook(card, cardName);
            if (embRes && embRes.wrote) {
                try { orbWorldList(); if (orbOpenNow && orbTab === 'world') renderOrbPanel(); } catch (e) { }
            }
        } catch (e) { /* 世界书这步失败不影响导入本身 */ }
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

/** 把「圆角 / 间距」这两个旋钮标成 !important。
    ⚠️ 为什么必须这么干（实测过）：
       酒馆自带主题 .Base_D / .Base_L 里有一条
         `*:not(#chat, #chat *, .avatar, .avatar *) { border-radius: var(--Radius) !important; }`
       而它们把 --Radius 设成 0px —— `*` 会把角色卡也扫进去，于是**卡片圆角被抹平**
       （表现为"切到某些美化后我的角色卡美化就不对了"）。
       生成后统一加 !important 比逐条去改模板稳（模板以后加新块也不会漏）。 */
function cardImportantify(css, isStudent) {
    let out = String(css || '')
        .replace(/(border-radius\s*:\s*var\(--pv-radius[^;)]*\))(?!\s*!important)/g, '$1 !important')
        .replace(/(margin(?:-bottom|-top)?\s*:\s*[^;{}]*var\(--pv-gap[^;)]*\)(?:[^;{}]*)?)(?!\s*!important)/g, '$1 !important')
        .replace(/(gap\s*:\s*[^;{}]*var\(--pv-gap[^;)]*\))(?!\s*!important)/g, '$1 !important');
    /* 只给「学生证」补一条纸底兜底。
       ⚠️ 为什么必须这么干（实测，两次踩）：
         主题可以直接给卡片写
           `.character_select.entity_block, .avatar-container { background: linear-gradient(...) !important; }`
         选择器比我们更具体 + 带 !important，于是：
           ① background-color 被顶掉 → 纸底变主题色
           ② 就算只锁住 color，那层暗渐变还盖在上面 → 看着还是黑的
         所以要 color + image 一起锁：纸白就是纸白，不跟美化走（用户明确要的"写死"）。
         确认过：8 种卡片样式没有任何一种靠 .character_select 的 background-image
         （歌单行的渐变画在列表容器上），所以 image:none 不会连累别的样式。
         hover 一起写，免得鼠标划过又变回主题色。
       ⚠️ 开关必须看「当前样式是不是学生证」，不能拿 CSS 里有没有 --id-paper 来判断：
          --id-* 那一串是 cardVarsCSS() 对**所有样式**都会输出的，
          按它判断等于给 8 种样式全套上白纸底 ——
          遮罩渐隐透出来的底色就成了白的（用户反馈的「所有图的渐隐都变成白色渐隐」就是这个）。
          2026-09-26 修正：改成显式传样式标记，纸底只跟学生证走。 */
    if (isStudent) {
        out += '\n/* 纸底兜底（见 cardImportantify 注释）：color + image 一起锁死 */\n'
            + '#rm_print_characters_block .character_select, #rm_print_characters_block .character_select:hover{'
            + 'background-color:var(--id-paper,#f6f6f8) !important; background-image:none !important;}\n'
            + '#rm_print_characters_block .character_select .avatar, #rm_print_characters_block .character_select:hover .avatar{'
            + 'background-color:#fff !important; background-image:none !important;}\n';
        /* 文字免疫层：颜色 / 字号 / 字体继承一起钉死。
           ⚠️ 为什么（实测跨 23 个主题量的）：
             主题会直接写 `.ch_name{ color:…; font-size:12px }`、`.tags_inline .tag{ color:… }`，
             选择器比样式本体更具体 → 卡片自己的 `color:var(--id-ink)` 和 `font-size:var(--pv-name)`
             全被顶掉。墨色纸卡(#f6f6f8)上换成主题的浅色小字 → **看不见**（用户反馈的就是这个）。
             颜色一律取当前「证件配色」的 --id-ink/--id-label/--id-strong：
             纸白/牛皮档是深墨、暗夜档自动变浅（--id-ink 本来就按档给），所以三个档都清楚。
           font-family 用 `inherit`：拦住主题给单个元素换字体，又保留用户现在看到的那套字。
           学生证编号那行本来就是 Arial Black，不动它。 */
        out += '/* 文字免疫层：颜色/字号/字体继承钉死（见 cardImportantify 注释）*/\n'
            + '#rm_print_characters_block .character_select .ch_name,'
            + '#rm_print_characters_block .character_select .ch_name span,'
            + '#rm_print_characters_block .character_select.is_fav .ch_name,'
            + '#rm_print_characters_block .character_select .tags_inline,'
            + '#rm_print_characters_block .character_select.is_fav .tags_inline,'
            + '#rm_print_characters_block .character_select .tags_inline .tag,'
            + '#rm_print_characters_block .character_select.is_fav .tags_inline .tag{'
            + 'font-family:inherit !important; color:var(--id-ink,#3c3c42) !important;}\n'
            + '#rm_print_characters_block .character_select .ch_name,'
            + '#rm_print_characters_block .character_select.is_fav .ch_name{'
            + 'font-size:var(--pv-name,16px) !important;}\n'
            + '#rm_print_characters_block .character_select .ch_name::before,'
            + '#rm_print_characters_block .character_select .tags_inline::before{'
            + 'color:var(--id-label,#8d8d95) !important;}\n'
            + '#rm_print_characters_block .character_select .character_select_container{'
            + 'font-family:inherit !important; color:var(--id-ink,#3c3c42) !important;}\n'
            + '#rm_print_characters_block .character_select .ch_description{'
            + 'font-family:inherit !important; color:var(--id-strong,#5c5c63) !important;'
            + 'font-size:var(--pv-desc,11.5px) !important;}\n'
            + '#rm_print_characters_block .character_select .tags_inline .tag{'
            + 'font-size:10px !important; background:transparent !important;}\n';
    }
    return out;
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
    const css = '/* 鼠鼠小助手 · 角色卡样式：' + def.name + ' */\n' + cardImportantify(cardAssembleCSS(c), c.style === 'student');
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
    /* ⚠️ 顺手清掉"指向已经不存在的角色"的僵尸条目：删过卡之后旧名字会一直留在顺序表里
       （实测堆过 5 条），不会显示错，但越攒越多、排查时看不懂。 */
    let alive = null;
    try {
        const ctx = getContext() || {};
        if (Array.isArray(ctx.characters)) alive = new Set(ctx.characters.map(c => c && c.avatar).filter(Boolean));
    } catch (e) { }
    s.cardOrder = visible.concat(s.cardOrder.filter(a => !seen.has(a) && (!alive || alive.has(a))));
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
    /* 快捷按钮托盘（悬浮在输入框上方）：默认开、贴右、两个按钮都开。
       ⚠️ 具体字段的归一化写在 quickBarSettings() 里（那边还能按 QUICK_BUTTONS 补每个按钮的开关），
          这里只保证 s.quickBar 是个对象。 */
    if (!s.quickBar || typeof s.quickBar !== 'object') s.quickBar = {};
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
    try { orbEditorUnmount(); } catch (e) { }    // 借来的写卡块还家（关扩展时）
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
   运行时错误收集（给「完整性检查」用）
   --------------------------------------------------------------------------
   为什么要自己收：出事的那一刻用户只看到"东西不见了"，控制台他打不开、
   或者打开也看不懂。这里把本页发生过的 JS 报错和未处理的 Promise 拒绝
   攒起来（滚动保留最后 40 条），点一下检查按钮就能连现场一起复制出来。
   ⚠️ 只读收集，不拦截、不改变任何原有行为（handler 一律原样返回 false）。
   ========================================================================== */
const SSP_ERR_MAX = 40;
const SSP_ERR_LOG = [];
let sspErrHooked = false;
/** 只留可能和本插件有关的报错（第三方扩展的报错太多，全会把有用的淹掉） */
const SSP_ERR_KEEP = /shushu|ssp[-_]|ShuShuPanel|shushu_panel|cardStyle|cardImportantify|orbWb|orbEntry|orbDlc|orbBg|orbPersona|orbPreset|orbTheme|orbData|orbChat|orbNotes|ssp_card_css|ssp_orb|ssp_mount|ssp_box|ssp_cardslot/i;

function sspPushErr(kind, msg, extra) {
    try {
        const s = String(msg == null ? '' : msg);
        if (!s) return;
        /* 无关的第三方报错直接丢：不然有用的会被淹掉 */
        if (!SSP_ERR_KEEP.test(s) && !SSP_ERR_KEEP.test(String(extra || ''))) return;
        const now = new Date();
        const hh = ('0' + now.getHours()).slice(-2), mm = ('0' + now.getMinutes()).slice(-2), ss = ('0' + now.getSeconds()).slice(-2);
        SSP_ERR_LOG.push('[' + hh + ':' + mm + ':' + ss + '] ' + kind + '：' + s.slice(0, 400)
            + (extra ? '　（位置：' + String(extra).slice(0, 160) + '）' : ''));
        while (SSP_ERR_LOG.length > SSP_ERR_MAX) SSP_ERR_LOG.shift();
    } catch (e) { /* 收集器自己绝不能抛错 */ }
}
function sspHookErrors() {
    if (sspErrHooked) return false;
    sspErrHooked = true;
    try {
        globalThis.addEventListener?.('error', ev => {
            const t = ev && ev.target;
            /* 资源加载失败（img/script/link）也记 —— 高清头像换原图失败就是这种 */
            if (t && t !== globalThis && t.tagName) {
                sspPushErr('资源加载失败', (t.tagName + ' ' + (t.src || t.href || '')), '');
                return false;
            }
            sspPushErr('JS 报错', (ev && ev.message) || '未知错误',
                (ev && ev.filename ? ev.filename + ':' + ev.lineno + ':' + ev.colno : ''));
            return false;
        }, true);
        globalThis.addEventListener?.('unhandledrejection', ev => {
            const r = ev && ev.reason;
            sspPushErr('未处理的 Promise 拒绝', (r && (r.message || r)) || '未知原因', (r && r.stack ? String(r.stack).split('\n')[0] : ''));
            return false;
        });
    } catch (e) { /* 无妨 */ }
    return true;
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
            /* 🩺 完整性检查：跑一遍、把结果写进下面的框；再点一次就重跑 */
            if (ev.target.closest('[data-ssp-diag]')) {
                const out = wrap.querySelector('[data-ssp-diagout]');
                let txt;
                try { txt = sspIntegrityProbe(); }
                catch (e) {
                    txt = '🐭 完整性检查\n检查过程本身出错了（这本身就是个 bug，请把下面这段发我）：\n'
                        + String((e && e.stack) || e);
                }
                if (out) out.value = txt;
                const line = String(txt).split('\n')[0] || '';
                toast(line.replace(/^结论：/, '检查完成：'), /异常/.test(line) ? 'warning' : 'success');
                return;
            }
            if (ev.target.closest('[data-ssp-diagcopy]')) {
                const out = wrap.querySelector('[data-ssp-diagout]');
                const txt = out && out.value ? out.value : '';
                if (!txt) { toast('先点上面的「开始检查」', 'warning'); return; }
                /* 优先剪贴板；http 页面上 clipboard 可能不可用 → 退回 execCommand */
                const done = () => toast('已复制，粘贴给开发者就行', 'success');
                try {
                    if (globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(txt).then(done, () => { if (out && out.select) { out.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中文本框内容', 'warning'); } } });
                        return;
                    }
                } catch (e) { /* 退回下面的老办法 */ }
                try { if (out && out.select) { out.select(); document.execCommand('copy'); done(); } }
                catch (e) { toast('复制失败，请手动选中文本框内容', 'warning'); }
                return;
            }
        });
        /* 下拉框 / 复选框 / 文字框：改完立刻生效并落盘 */
        wrap.addEventListener('change', ev => {
            const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
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
            /* ---- 快捷按钮托盘 ---- */
            if (t.dataset.sspQbanchor) { quickBarSettings().anchor = t.value; save(); qbPlace(); return; }
            if (t.dataset.sspQblabel !== undefined) { quickBarSettings().showLabel = Boolean(t.checked); save(); qbMount(); return; }
            if (t.dataset.sspQbnum) { quickBarSettings()[t.dataset.sspQbnum] = Number(t.value); save(); qbMount(); return; }
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
            const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
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
const PANEL_VERSION = '1.31.83';   // 面板上显示的版本号（改 manifest 时记得一起改）
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

/* ==========================================================================
   🩺 完整性检查（面板最底下那个按钮）
   --------------------------------------------------------------------------
   用户视角的诉求：「我这个插件是不是坏了？坏在哪？我描述不清楚，你把现场拿走。」
   所以这里只做两件事：
     ① 把插件依赖的每一块 DOM/设置逐项核对一遍（在 → 不在 → 为什么不在）
     ② 把本页攒下来的、和本插件有关的报错一起附上，整段可一键复制
   ⚠️ 全程只读：不写设置、不动 DOM、不修任何东西。
      修不修是下一步的事 —— 先拿到现场。
   ========================================================================== */
/** 某项检查：ok=true 过 / false 不过（note 是给人看的一句话）
    ⚠️ 往 L 里塞的必须是**字符串**（后面要按前后缀统计 ★/☆）；结构化结果单独放 cks */
function sspCk(L, cks, name, ok, note) {
    const okk = Boolean(ok);
    cks.push({ ok: okk, name: name, note: note || '' });
    L.push((okk ? '  ✓ ' : '  ★ ') + name + (note ? '：' + note : ''));
    return okk;
}
/** 元素在不在 + 视觉上有没有尺寸（0×0 = 在 DOM 里但用户看不到，最常见的"消失了"） */
function sspBoxOf(selOrEl) {
    const el = typeof selOrEl === 'string' ? query(selOrEl) : selOrEl;
    if (!el) return { el: null, exists: false, w: 0, h: 0, visible: false, display: '(不存在)' };
    const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const cs = globalThis.getComputedStyle ? globalThis.getComputedStyle(el) : null;
    const display = cs ? cs.display : '(量不到)';
    return {
        el: el, exists: true,
        w: Math.round(r.width), h: Math.round(r.height),
        visible: display !== 'none' && r.width > 0 && r.height > 0,
        display: display,
    };
}

/** 从扩展脚本的 URL 里读酒馆的缓存串（`...index.js?v=1792…` 或 `?version=1.31.41`）
    —— 用来判断"浏览器里跑的是不是最新那份文件" */
function sspScriptVersion() {
    try {
        const s = document.currentScript
            || query('script[src*="ShuShuTweaks/index.js"]')
            || query('script[src*="extensions"][src*="index.js"]');
        const src = s && s.getAttribute ? (s.getAttribute('src') || '') : '';
        const m = /[?&](?:version|v)=([^&]+)/.exec(src);
        return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
}

function sspIntegrityProbe() {
    const L = [];
    const cks = [];          // 结构化结果（给汇总用）
    const notes = [];        // 需要额外说一句的提示（☆ 开头）
    const detail = {};
    const s = getSettings();
    const dev = activeDevice();
    const layout = layoutOf(s, dev);

    L.push('🐭 鼠鼠小助手 · 完整性检查');
    L.push('时间：' + new Date().toLocaleString());
    L.push('版本：v' + PANEL_VERSION + (sspScriptVersion() ? '（浏览器缓存串 ' + sspScriptVersion() + '）' : ''));
    L.push('模块名：' + MODULE_NAME + '　设备：' + dev + '（窗口 ' + globalThis.innerWidth + '×' + globalThis.innerHeight + '）');
    L.push('浏览器：' + String(globalThis.navigator && globalThis.navigator.userAgent || '').slice(0, 120));
    L.push('');

    /* ---------- 1. 基本依赖 ---------- */
    L.push('── 1. 基本依赖 ──');
    let ctx = null;
    try { ctx = getContext() || null; } catch (e) { ctx = null; }
    sspCk(L, cks, '酒馆 getContext()', !!ctx, ctx ? '' : '★ 拿不到酒馆上下文 → 插件根本没启动，所有功能都不会有');
    sspCk(L, cks, '扩展设置容器 extensionSettings', !!(ctx && ctx.extensionSettings), !ctx ? '上下文都没有' : (ctx.extensionSettings ? '' : '★ 酒馆还没把设置加载进来'));
    const store = ctx && ctx.extensionSettings ? ctx.extensionSettings[MODULE_NAME] : null;
    sspCk(L, cks, '本扩展设置键 ' + MODULE_NAME, !!store, store ? '' : '★ 设置键丢了 → 你的布局/样式会回到默认（MODULE_NAME 被改过就是这个症状）');
    sspCk(L, cks, '面板工坊总开关 enabled', s.enabled !== false, s.enabled === false ? '★ 是关着的 —— 关着的时候插件会主动把自己撤干净，界面看着就像"东西没了"' : '');
    sspCk(L, cks, '设置版本 schemaVersion', Number(s.schemaVersion) === SCHEMA_VERSION, '当前 ' + s.schemaVersion + '，代码要 ' + SCHEMA_VERSION + (Number(s.schemaVersion) === SCHEMA_VERSION ? '' : '（旧配置会自动升级）'));

    /* ---------- 2. 鼠鼠面板本体 ---------- */
    L.push('');
    L.push('── 2. 鼠鼠面板本体 ──');
    const pRoot = sspBoxOf('#ssp_panel_root');
    const pEl = sspBoxOf('#ssp_panel');
    const slot = sspBoxOf('#ssp_cardslot');
    const styleSel = query('[data-ssp-card-style]');
    const crowN = queryAll('#ssp_cardslot .ssp-crow').length;
    const secN = queryAll('#ssp_panel .ssp-sec').length;
    sspCk(L, cks, '面板根节点 #ssp_panel_root', pRoot.exists, pRoot.exists ? '没打开时 display=none 是正常的' : '★ 面板容器没建起来 → 点「打开鼠鼠面板」会没反应');
    sspCk(L, cks, '面板 #ssp_panel', pEl.exists, pEl.exists ? '' : '★ 面板本体不在 DOM 里');
    sspCk(L, cks, '分区数量', secN >= 8, '数到 ' + secN + ' 个分区' + (secN >= 8 ? '' : '（正常 ≥8；少了说明面板是旧的/被截断了）'));
    sspCk(L, cks, '角色卡样式槽位 #ssp_cardslot', slot.exists, slot.exists ? '' : '★ 槽位不存在 —— 这就是"角色卡样式那块消失了"的直接原因');
    sspCk(L, cks, '角色卡样式行数', crowN >= 15, '数到 ' + crowN + ' 行' + (crowN >= 15 ? '' : '（正常 17 行：样式下拉/高清头像/颜色/渐隐/取景/对齐/高度/圆角/间距/叠压/字号×2/歌单底色/显示什么/学生证/量一下卡片）'));
    /* ★ 关键补充：「在 DOM 里」不等于「用户看得见」。
       实测（手机 390×844）：这一块自己就 1080px，而面板体可视高只有 680px —— 如果它前面
       压着「悬浮球 + 思维链收纳」两个分区，它会被推到屏幕外，用户看到的就是「只剩最上面一行」
       或「下面的调整界面没有了」。这里把"折叠无关分区后还剩多少行在视口里"量出来，
       让报告能一句话区分「没渲染」和「渲染了但在屏幕外」。 */
    const cardSecEl = slot.el ? slot.el.closest('.ssp-sec') : null;
    if (cardSecEl) {
        const beforeTop = cardSecEl.getBoundingClientRect().top;
        const collapsed = [];
        queryAll('#ssp_panel .ssp-sec').forEach(sec => {
            if (sec !== cardSecEl && !sec.classList.contains('ssp-folded')) {
                sec.classList.add('ssp-folded');
                collapsed.push(sec);
            }
        });
        const visRows = queryAll('#ssp_cardslot .ssp-crow').filter(r => {
            const rr = r.getBoundingClientRect();
            return rr.height > 0 && rr.top >= 0 && rr.bottom <= globalThis.innerHeight;
        }).length;
        collapsed.forEach(sec => sec.classList.remove('ssp-folded'));
        const afterTop = cardSecEl.getBoundingClientRect().top;
        detail.角色卡样式可视性 = { 折叠前top: Math.round(beforeTop), 折叠后top: Math.round(afterTop), 折叠后一屏可见行数: visRows, 行总数: crowN, 面板体可视高: (query('#ssp_panel .ssp-p-body') || {}).clientHeight || 0 };
        /* ⚠️ 用户实测过的坑：选「原版（不改动）」之后，那一整块连同**下拉框自己**被 hidden →
           用户再也找不到下拉、换不回任何样式。这里把"下拉必须一直可见"变成机器可查的一条。 */
        try {
            const selEl = query('#ssp_cardslot [data-ssp-card-style]');
            const secVis = !!(cardSecEl && cardSecEl.getClientRects().length);
            const selVis = !!(selEl && selEl.getClientRects().length);
            const styleNow = cardStyleSettings().style;
            sspCk(L, cks, '样式下拉框「选原版后还在」', !!selEl && (selVis || styleNow !== 'none'),
                !selEl ? '★ 找不到 #ssp_cardslot [data-ssp-card-style] —— 没法换样式'
                    : (selVis ? ('可见，当前 ' + styleNow) : ('★ 下拉框不可见（当前样式 ' + styleNow + '）—— 用户换不回来了！')));
            if (secVis) { /* 整段在就行，不用再断言 */ }
        } catch (e) { }

        /* 快捷按钮托盘：开了就得在、而且得在输入框**上方** */
        try {
            const q = quickBarSettings();
            const qel = document.getElementById(QUICK_BAR_ID);
            const form = document.getElementById('send_form');
            if (q.on !== false) {
                /* ⚠️ 这条检查是从**设置面板里**跑的，而设置面板是全屏浮层 —— 它会把托盘盖住，
                   此时 qbPlace() 会（正确地）把托盘藏起来。所以"面板开着所以看不见"要算正常，
                   否则每次检查都报一个假的 ★（踩过）。 */
                const panelOn = !!document.querySelector('#ssp_panel_root.on');
                const vis = !!(qel && qel.getClientRects().length);
                const qr = vis && qel ? qel.getBoundingClientRect() : null;
                const fr = form ? form.getBoundingClientRect() : null;
                const above = !!(qr && fr && qr.bottom <= fr.top + 2);
                sspCk(L, cks, '快捷按钮托盘', !!qel && (vis || panelOn),
                    !qel ? '★ 托盘不在（设置里开着但没建起来）'
                        : (panelOn && !vis ? ('按钮 ' + qbList().length + ' 个；设置面板开着时被它盖住是正常的，关掉面板就会回来')
                            : ('按钮 ' + qbList().length + ' 个 · 挂在「' + (QB_ANCHOR_NAME[q.anchor] || q.anchor) + '」，'
                            + (above ? '位置在输入区上方 ✓' : '★ 不在输入区上方（可能在别的页面或被挡住了）'))));
            } else { sspCk(L, cks, '快捷按钮托盘', true, '设置里关着（跳过）'); }
        } catch (e) { }
        sspCk(L, cks, '角色卡样式「看得见」', beforeTop < globalThis.innerHeight,
            beforeTop < globalThis.innerHeight
                ? ('起始位置 top=' + Math.round(beforeTop) + '（视口高 ' + globalThis.innerHeight + '），折叠上面那些分区后能看见 ' + visRows + '/' + crowN + ' 行')
                : ('★ 它在屏幕外：折叠前 top=' + Math.round(beforeTop) + '（视口高 ' + globalThis.innerHeight + '），'
                    + '折叠掉上面那些分区后就到 top=' + Math.round(afterTop) + '、能看见 ' + visRows + '/' + crowN + ' 行。'
                    + '原因：这一块自己就有 ' + Math.round(cardSecEl.getBoundingClientRect().height) + 'px，'
                    + '而面板可视高只有 ' + ((query('#ssp_panel .ssp-p-body') || {}).clientHeight || 0) + 'px —— 需要往下滚，'
                    + '或者点上面分区的标题把它们折叠起来'));
    }
    sspCk(L, cks, '样式下拉框 [data-ssp-card-style]', !!styleSel, styleSel ? '当前值 ' + styleSel.value : '★ 下拉框不在 → 没法换样式');
    sspCk(L, cks, '「展开装配面板」按钮 [data-ssp-open]', !!query('[data-ssp-open]'), query('[data-ssp-open]') ? '' : '★ 按钮不在 → 装配入口没了');
    sspCk(L, cks, '「恢复原版」按钮 [data-ssp-restore]', !!query('[data-ssp-restore]'), query('[data-ssp-restore]') ? '' : '★ 按钮不在');
    detail.面板 = { 分区数: secN, 样式行数: crowN, 面板文本长度: (query('#ssp_panel') || {}).textContent ? query('#ssp_panel').textContent.length : 0 };

    /* ---------- 3. 布局配置 vs 实际 DOM ---------- */
    L.push('');
    L.push('── 3. 布局配置 vs 实际 DOM ──');
    const dupIds = [];
    (layout.modules || []).forEach(m => {
        const used = [].concat(...(m.rows || []));
        used.forEach(id => { if (used.filter(x => x === id).length > 1 && dupIds.indexOf(id) < 0) dupIds.push(id); });
    });
    sspCk(L, cks, '布局模块数', (layout.modules || []).length > 0, (layout.modules || []).length + ' 个模块，分区 ' + JSON.stringify(layout.zones || {}));
    sspCk(L, cks, '同一按钮没有重复占位', dupIds.length === 0, dupIds.length ? '★ 重复的按钮 id：' + dupIds.join('、') + '（会导致按钮来回跳 / 丢位置）' : '');
    const placedIds = new Set([].concat(...Object.keys(layout.zones || {}).map(z => layout.zones[z] || [])));
    const missingNative = [];
    BUTTONS.forEach(b => {
        if (!b.native || !placedIds.has(b.id)) return;
        const el = resolveNative(b);
        if (!el || el.isConnected === false) missingNative.push(b.name + '(' + b.native + ')');
    });
    sspCk(L, cks, '原生按钮都在', missingNative.length === 0, missingNative.length ? '★ 找不到：' + missingNative.join('、') + '（酒馆改了 DOM 或按钮被搬丢了；这些按钮会从面板上消失）' : '');
    sspCk(L, cks, '新增按钮都造出来了', BUTTONS.filter(b => b.isNew && b.made).every(b => !!newEls.get(b.id)),
        '新增：' + BUTTONS.filter(b => b.isNew && b.made).map(b => b.id).join('/'));
    /* 哪些模块被判成"空"而收起来了 —— 这是用户眼里"模块消失"最常见的原因 */
    const hidMods = [];
    modEls.forEach((rec, id) => { if (rec.root && rec.root.style.display === 'none') hidMods.push(id); });
    sspCk(L, cks, '没有模块被收起来', hidMods.length === 0, hidMods.length ? '★ 被收起：' + hidMods.join('、') + '（模块里一个按钮都没认领到就会自动隐藏）' : '');
    const hidZones = [];
    zoneEls.forEach((el, z) => { if (el && el.style.display === 'none') hidZones.push(z); });
    sspCk(L, cks, '分区都在显示', hidZones.length === 0, hidZones.length ? '★ 被收起的分区：' + hidZones.join('、') : '');
    detail.布局 = { 模块: (layout.modules || []).map(m => m.id + ':' + m.rows.map(r => r.join('+')).join('|')), zones: layout.zones };

    /* ---------- 4. 角色卡样式 ---------- */
    L.push('');
    L.push('── 4. 角色卡样式（她出问题的这一块）──');
    const c = cardStyleSettings();
    const styleOk = c.style === 'none' || !!CARD_STYLES[c.style];
    const csEl = document.getElementById(CARD_STYLE_ID);
    sspCk(L, cks, '当前样式值合法', styleOk, '当前 style=' + c.style + (styleOk ? '' : ' ★ 不是已知样式，会回落到默认'));
    sspCk(L, cks, '样式表 ' + CARD_STYLE_ID, c.style === 'none' ? true : !!csEl,
        c.style === 'none' ? '当前是「原版」，本来就不该有注入（正常）' : (csEl ? '已注入 ' + csEl.textContent.length + ' 字符' : '★ 选了样式却没注入 CSS → 卡片会看着没美化'));
    const cards = queryAll('#rm_print_characters_block .character_select');
    const c0 = sspBoxOf(cards[0]);
    const listBox = sspBoxOf('#rm_print_characters_block');
    const blockBox = sspBoxOf('#rm_characters_block');
    sspCk(L, cks, '角色列表容器在', listBox.exists, listBox.exists ? '' : '★ 找不到 #rm_print_characters_block');
    sspCk(L, cks, '角色列表当前可见', listBox.visible, listBox.visible ? '' : '见下面 ☆ 提示');
    if (!listBox.visible) notes.push('☆ 角色列表现在看不到：卡容器 ' + listBox.w + '×' + listBox.h
        + '，容器 #rm_characters_block display=' + blockBox.display + '。'
        + (blockBox.display === 'none'
            ? '这是酒馆的正常行为 —— 点完一张卡进聊天它就会收起，再点顶部「角色列表」按钮就能叫回来。'
            + '注意：此时装配面板的挂载点也在它里面，会跟着变成 0×0（点不到），要用装配得先把列表打开。'
            : '容器还在布局里但尺寸是 0，可能是被别的样式/扩展压住了（这时候"是酒馆收起了列表"这条解释不成立）。'));
    sspCk(L, cks, '列表里有卡片', cards.length > 0, '数到 ' + cards.length + ' 张');
    sspCk(L, cks, '卡片有实际尺寸', cards.length === 0 || c0.visible, c0.visible ? '首卡 ' + c0.w + '×' + c0.h : '★ 首卡 ' + c0.w + '×' + c0.h + '（用户看到的就是"列表空了"）');
    /* 卡片能不能点：排序模式会主动屏蔽点击（用户报"点不进去"的头号原因） */
    const sorting = !!(document.body && document.body.classList && document.body.classList.contains(SORT_CLASS));
    sspCk(L, cks, '不是"手动排序"模式', !sorting, sorting ? '★ 排序模式开着 —— 这时候点卡片是"拖动"、不会进聊天（面板最底下「角色列表排序」里点一次「手动排序」即可关掉）' : '');
    const cardPE = c0.el && globalThis.getComputedStyle ? globalThis.getComputedStyle(c0.el).pointerEvents : '(量不到)';
    sspCk(L, cks, '卡片可点（pointer-events）', cardPE === 'auto', '首卡 pointer-events=' + cardPE);
    detail.角色卡 = { style: c.style, 注入长度: csEl ? csEl.textContent.length : 0, 卡片数: cards.length, 首卡: c0.w + 'x' + c0.h, 排序模式: sorting, 列表display: blockBox.display };

    /* ---------- 5. 面板工坊的挂载点 ---------- */
    L.push('');
    L.push('── 5. 面板工坊挂载点（装配）──');
    const mountBox = sspBoxOf('#' + MOUNT_ID);
    const zoneHead = sspBoxOf('#' + ZONE_PREFIX + 'head');
    const zoneFoot = sspBoxOf('#' + ZONE_PREFIX + 'foot');
    sspCk(L, cks, '装配挂载 #' + MOUNT_ID + ' 在', mountBox.exists, mountBox.exists ? '' : '★ 挂载点不在（角色列表收起时会被一起藏起来）');
    sspCk(L, cks, '装配挂载有尺寸', mountBox.visible, mountBox.exists ? (mountBox.visible ? '' : '见下面 ☆ 提示') : '');
    if (mountBox.exists && !mountBox.visible) notes.push('☆ 装配挂载 ' + mountBox.w + '×' + mountBox.h + '（点不到）：它挂在角色列表顶部，列表一收起就跟着 0×0。'
        + '先把角色列表打开，再点列表顶部那条「装配面板 ▾」。');
    sspCk(L, cks, '分区 head 在', zoneHead.exists, zoneHead.exists ? '' : '★ 头部按钮条的分区没建起来');
    sspCk(L, cks, '分区 foot 在', zoneFoot.exists, zoneFoot.exists ? '' : '★ 底部栏分区没建起来');
    const boxEl = sspBoxOf('#' + BOX_ID);
    sspCk(L, cks, '装配界面 #' + BOX_ID, true, boxEl.exists ? '开着（' + boxEl.w + '×' + boxEl.h + '）' : '收起着（正常，点「展开装配面板」才出现）');
    /* 遮罩提示：这是"点了展开却看不见"的已知坑 */
    const panelOpenNow = !!query('#ssp_panel_root.on');
    if (panelOpenNow && boxEl.exists) {
        notes.push('☆ 鼠鼠面板是带全屏遮罩的弹层（z-index 30000），装配界面在它**后面** —— '
            + '开着面板点「展开装配面板」，装配框其实出现了但被遮住看不见。'
            + '请先按 Esc 关掉面板，再从角色列表顶部那条「装配面板 ▾」开（已知 bug，待修）。');
    }

    /* ---------- 6. 悬浮球 ---------- */
    L.push('');
    L.push('── 6. 悬浮球 / 鼠鼠口袋 ──');
    const orbOn = s.orbOn !== false;
    const ball = sspBoxOf('#ssp_orb');
    const orbRoot = sspBoxOf('#ssp_orb_root');
    const orbPanel = sspBoxOf('#ssp_orb_panel');
    sspCk(L, cks, '悬浮球开关 orbOn', true, orbOn ? '开着' : '☆ 是关着的（收回状态）—— 想要球就回面板勾「显示悬浮球」');
    if (orbOn) {
        sspCk(L, cks, '球 #ssp_orb 在', ball.exists, ball.exists ? '位置 ' + ball.w + '×' + ball.h : '★ 球不在 DOM 里');
        sspCk(L, cks, '球有尺寸', ball.visible, ball.visible ? '' : '★ 0×0：球被隐藏了（收回过？或位置算到屏幕外了）');
    }
    sspCk(L, cks, '口袋面板 #ssp_orb_panel 在', orbPanel.exists, orbPanel.exists ? '模块数 ' + ORB_MODULES.length + '（' + ORB_MODULES.map(m => m.name).join('/') + '）' : '☆ 口袋面板还没建（开一次球才会建，正常）');
    sspCk(L, cks, '口袋根 #ssp_orb_root', orbRoot.exists, orbRoot.exists ? '' : '☆ 还没建（开一次球才会建，正常）');

    /* ---------- 7. 本页报错 ---------- */
    L.push('');
    L.push('── 7. 本页报错（只收和本插件有关的）──');
    if (SSP_ERR_LOG.length) {
        L.push('共 ' + SSP_ERR_LOG.length + ' 条：');
        SSP_ERR_LOG.forEach(x => L.push('  ' + x));
        cks.push({ ok: false, name: '没有运行时报错', note: '上面这些就是要查的（越靠后越新）' });
    } else {
        L.push('（无 —— 从这次打开页面到现在，没收到和本插件有关的报错）');
        cks.push({ ok: true, name: '没有运行时报错', note: '' });
    }
    L.push('⚠️ 注意：报错只在**这一次打开页面之后**才有记录。如果问题是刷新前出的，');
    L.push('   请先复现一次（别刷新），再点这个检查。');

    /* ---------- 8. 明细 ---------- */
    L.push('');
    L.push('── 8. 明细（给开发者看的）──');
    let detailTxt = '';
    try { detailTxt = JSON.stringify(detail, null, 1); } catch (e) { detailTxt = '(序列化失败)'; }
    L.push(detailTxt);

    /* ---------- 汇总 ---------- */
    const bad = cks.filter(x => !x.ok);
    const warn = notes;
    const foot = [];
    if (notes.length) {
        foot.push('');
        foot.push('── 提示（☆，多数是酒馆的正常行为，不一定有问题）──');
        notes.forEach(n => foot.push('  ' + n));
    }
    if (bad.length) {
        foot.push('');
        foot.push('── 需要处理的项（★）──');
        bad.forEach(b => foot.push('  ★ ' + b.name + (b.note ? '：' + b.note.replace(/^[★☆]\s*/, '') : '')));
    }
    const head = [];
    head.push('结论：' + (bad.length
        ? '发现 ' + bad.length + ' 项异常' + (warn.length ? '、' + warn.length + ' 项提示' : '')
        : (warn.length ? '结构完整，有 ' + warn.length + ' 项提示' : '结构完整，没发现问题 ✓')));
    head.push('检查项 ' + cks.length + ' 项：通过 ' + cks.filter(x => x.ok).length + '，异常 ' + bad.length);
    return head.concat([''], L, foot).join('\n');
}

/* ==========================================================================
   设置面板（扁平）
   ========================================================================== */
function settingsPanelHTML() {
    const s = getSettings();
    const c = cardStyleSettings();
    const orderCount = (s.cardOrder || []).length;
    const pct = Math.round(importSimThreshold() * 100);

    const sec = (icon, title, inner, note) => `
      <section class="ssp-sec">
        <h4><i class="fa-solid ${icon}"></i>${esc(title)}<span class="ssp-sec-fold" data-ssp-fold="1" title="折叠 / 展开这一整块（想快点看到下面那块时用）"><i class="fa-solid fa-chevron-down"></i></span></h4>
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
        <h4><i class="fa-solid fa-image"></i>角色卡样式<span class="ssp-sec-fold" data-ssp-fold="1" title="折叠 / 展开这一整块（想快点看到下面那块时用）"><i class="fa-solid fa-chevron-down"></i></span></h4>
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

    /* —— 完整性检查（放在最底下，出问题才翻到这里）—— */
    const secDiag = sec('fa-stethoscope', '完整性检查', [
        frow('检查插件完整性', '逐项核对面板 / 装配 / 卡片样式 / 球 / 布局配置，并把本页的报错一起收上来',
            '<div class="ssp-pbtn" data-ssp-diag="1"><i class="fa-solid fa-play"></i>开始检查</div>'),
        '<textarea class="ssp-inp ssp-diagbox" data-ssp-diagout="1" readonly rows="7" '
        + 'placeholder="点上面的「开始检查」，结果会出现在这里 —— 然后按右边「复制全部」发给我"></textarea>',
        frow('把结果带走', '整段复制（含报错），粘给开发者最快定位',
            '<div class="ssp-pbtn" data-ssp-diagcopy="1"><i class="fa-solid fa-copy"></i>复制全部</div>'),
    ].join(''), '检查是<b>只读</b>的：不改设置、不动界面。带 ★ 的是异常、☆ 的是提示（多数是酒馆的正常行为，比如列表被收起）。');

    /* —— 导入即更新 —— */
    const secImport = sec('fa-file-import', '导入即更新', [
        frow('认出重复卡时问我', '把「导入 / 替换更新 / 从 URL 导入」并成一条路',
            fsw('data-ssp-importmerge="1"', importMergeOn())),
        frow('人设重合度阈值', '文字重合到这个程度就算同一张卡',
            `<input class="ssp-range" type="range" min="30" max="90" step="5" value="${pct}" data-ssp-impsim="1">`
            + `<b class="ssp-out" data-ssp-impout="1">${pct}%</b>`),
    ].join(''), '认卡顺序：<b>卡里的姓名</b> → <b>人设文字重合度</b> → 文件名。认出重复会问你「更新这一张 / 另存为新角色」；'
        + '更新后会自动补回局部正则 / 收藏 / 世界书绑定 / 深度提示。认不出的新卡直接导入，不弹窗。');

    /* —— 快捷按钮托盘（悬浮在输入框上方）—— */
const q0 = quickBarSettings();
const secQuick = sec('fa-wand-magic-sparkles', '快捷按钮托盘', [
    frow('开关都在这儿', '总开关 / 回底 / 重新发送 → 都在「鼠鼠口袋 → 美化 → 常用开关」里，随开随用',
        '<div class="ssp-pbtn" data-ssp-qbgoto="1"><i class="fa-solid fa-wand-magic-sparkles"></i>去常用开关</div>'),
    frow('挂在哪', '默认「发送按钮上方」——跟着发送键走，聊天栏居中/靠右都不会飘到别处', `<select class="ssp-inp" data-ssp-qbanchor="1">
        ${QB_ANCHORS.map(k => '<option value="' + k + '"' + (q0.anchor === k ? ' selected' : '') + '>' + esc(QB_ANCHOR_NAME[k]) + '</option>').join('')}
    </select>`),
    frow('按钮大小', '手机上太小会点不准', `<input class="ssp-crange" type="range" data-ssp-qbnum="size" min="24" max="56" step="1" value="${q0.size}">
        <b class="ssp-cval" data-ssp-qbout="size">${q0.size}px</b>`),
    frow('圆角', '0＝直角，越大越圆', `<input class="ssp-crange" type="range" data-ssp-qbnum="radius" min="0" max="26" step="1" value="${q0.radius}">
        <b class="ssp-cval" data-ssp-qbout="radius">${q0.radius}px</b>`),
    frow('不透明度', '平时半透明，鼠标划过会变实', `<input class="ssp-crange" type="range" data-ssp-qbnum="opacity" min="20" max="100" step="1" value="${Math.round(q0.opacity * 100)}">
        <b class="ssp-cval" data-ssp-qbout="opacity">${Math.round(q0.opacity * 100)}%</b>`),
    frow('距输入框', '托盘和输入框之间的空隙', `<input class="ssp-crange" type="range" data-ssp-qbnum="offset" min="0" max="60" step="1" value="${q0.offset}">
        <b class="ssp-cval" data-ssp-qbout="offset">${q0.offset}px</b>`),
    frow('显示文字', '关掉就只留图标（更省地方）', fsw('data-ssp-qblabel="1"', !!q0.showLabel)),
].join(''), '按钮都是**我们自己画的**：需要原生功能的一律"点酒馆那颗"（比如重新发送＝转发原生的「重新生成」），'
    + '没有原生按键的就自己实现（比如回底＝直接滚 #chat）。'
    + '<b>每个按钮的开关都在「鼠鼠口袋 → 美化 → 常用开关」里</b>（用户要求：随开随用）；'
    + '以后要加按钮，往按钮表里加一行，常用开关里会自动多一行。');

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
        ${secOrb}${secThink}${secCard}${secQuick}${secDetail}${secImport}${secBuild}${secSort}${secDiag}
      </div>
      <div class="ssp-p-foot">
        <span>改完立刻生效并落盘，不用点保存</span>
        <span class="ssp-p-foot-r">Esc 关闭</span>
      </div>
    </div>`;
}

/* 建面板（只建一次，建完留在 DOM 里，靠 .on 显隐） */
function mountSettingsPanel() {
    if (document.getElementById('ssp_panel')) return true;
    if (!document.body) return false;
    const box = document.createElement('div');
    box.id = 'ssp_panel_root';
    box.innerHTML = settingsPanelHTML();
    document.body.append(box);
    panelEl = document.getElementById('ssp_panel');
    sspBindSectionCollapse(box);
    return true;
}

/* ==========================================================================
   分区折叠（点分区标题就收起/展开那一块）
   --------------------------------------------------------------------------
   为什么加：手机实测（390×844）面板体可视高只有 680px，而里面排了 8 个分区、
   内容高 3399px —— 「角色卡样式」自己就 1243px，被前面两个大分区压到屏幕外，
   用户以为"那一块没了 / 只剩一行"。能折叠就没这个误会了。
   默认全部展开（不动用户现在的习惯），只是标题变成一个可点的开关。
   ========================================================================== */
function sspBindSectionCollapse(root) {
    if (!root) return false;
    root.querySelectorAll('#ssp_panel .ssp-sec > h4').forEach(h => {
        if (h.querySelector('.ssp-sec-chev')) return;
        const ch = document.createElement('i');
        ch.className = 'fa-solid fa-chevron-down ssp-sec-chev';
        h.append(ch);
        h.classList.add('ssp-sec-h');
        h.setAttribute('title', '点一下收起 / 展开这一块');
        h.setAttribute('role', 'button');
    });
    if (root.dataset.sspSecBind) return true;
    root.dataset.sspSecBind = '1';
    root.addEventListener('click', ev => {
        const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!t || !t.closest) return;
        /* 标题右边那个小箭头 = 折叠/展开这一整块（就是想快点看到下面那块时点的） */
        const fold = t.closest('[data-ssp-fold]');
        if (fold) {
            const sec = fold.closest('.ssp-sec');
            if (sec) sec.classList.toggle('ssp-folded');
            return;
        }
        const h = t.closest('#ssp_panel .ssp-sec > h4');
        if (!h) return;
        /* 标题里要是哪天放了真的控件，别把它的点击吃掉 */
        if (t.closest('input, select, textarea, button, a, .menu_button, .ssp-pbtn')) return;
        const sec = h.parentElement;
        if (!sec) return;
        sec.classList.toggle('ssp-collapsed');
    });
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

/** 抽屉里的「角色卡样式」那一块
    ⚠️ 行的顺序是按「手机上能不能第一眼看到」排的（实测：手机面板可视高只有 680px，
       这一块一共 1243px —— 旧顺序把最常用的样式/高度/圆角排在第 8~10 行，全在屏幕外，
       用户以为"角色卡样式只剩了最上面一行"）。所以：
         第 1~2 行  = 样式 + 高清头像（最先要动的）
         第 3~6 行  = 卡片高度 / 圆角 / 间距 / 名字字号（配合样式微调）
         第 7~10 行 = 渐隐 / 取景 / 对齐 / 图片颜色（调风格）
         第 11 行起 = 叠压 / 简介字号 / 歌单底色 / 显示什么 / 学生证（用得少） */
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
    /* ⚠️⚠️ 这一整块的 hidden **绝对不能包住那个样式下拉框**。
       以前的写法是 `<div class="ssp-cardsec"${on ? '' : ' hidden'}>` —— 整段一起收，于是：
         · 用户在下拉里选了第一项「原版（不改动）」→ 整段（含下拉自己）被 hidden → **那块直接消失**；
         · 每次重画面板都按"当前样式是不是 none"重算 → 永远 hidden →
           **用户再也找不到那个下拉，换不回任何样式**。
           （用户实测：「点击角色卡样式里的第一个也就是原版选项，就会直接消失」，
             以及最早的「恢复原版后角色卡样式那块消失」。）
       现在的结构：**下拉永远在**；只有下面那堆"旋钮"跟着 hidden，并给一句说明告诉用户怎么换回来。 */
    return `<div class="ssp-cardsec">
        ${row('角色卡样式', '<select class="text_pole ssp-cinput" data-ssp-card-style="1">' + opts + '</select>')}
        ${on ? '' : '<div class="ssp-note ssp-cnote">现在用的是 <b>原版（不改动）</b>：角色卡完全按酒馆本来的样子显示。想恢复魔改，就在上面这个下拉里再选一个样式（9 种都在里面）。</div>'}
        <div class="ssp-cardknobs"${on ? '' : ' hidden'}>
        ${row('高清头像', '<label class="ssp-ccheck"><input type="checkbox" data-ssp-card-check="hd" ' + (c.hd ? 'checked' : '') + '><span>换成原图（酒馆缩略图只有 96×144，铺满整行会糊）</span></label>', true)}
        ${/* ⚠️ 这几行是手机上的"床头开关"：必须排在最前面看得见（见函数头注释） */''}
        ${slider('h', '卡片高度', 40, 420, 1, 'px')}
        ${slider('radius', '圆角', 0, 40, 1, 'px')}
        ${slider('gap', '卡片间距', 0, 40, 1, 'px')}
        ${slider('name', '名字字号', 10, 34, 0.5, 'px')}
        ${row('渐隐方式', sel('fade', [['mask', '遮罩（自适应底色）'], ['solid', '色块覆盖'], ['none', '不渐隐']]))}
        ${slider('fadeStop', '渐隐强度', 0, 100, 1, '%')}
        ${row('取景', sel('focus', [['18%', '偏上'], ['32%', '居中'], ['62%', '偏下']]))}
        ${row('内容对齐', sel('align', [['left', '靠左'], ['center', '居中'], ['right', '靠右']]))}
        ${row('图片颜色', sel('color', [['hover', '悬停变彩'], ['always', '一直彩色'], ['gray', '一直灰']]))}
        ${slider('overlay', '叠压程度', 0, 90, 5, '%')}
        ${slider('desc', '简介字号', 8, 24, 0.5, 'px')}
        ${row('歌单底色', `<input type="color" class="ssp-ccolor" data-ssp-card-color="songBg" value="${esc(/^#[0-9a-f]{6}$/i.test(String(c.songBg)) ? c.songBg : '#4a2b7d')}" title="只有「歌单行」样式用得到">
            <b class="ssp-cval" data-ssp-card-out="songBg">${esc(String(c.songBg || '#4a2b7d'))}</b>
            <span class="ssp-creset menu_button" data-ssp-card-color="songBg" data-ssp-color-reset="1">默认紫</span>`, true)}
        ${row('显示什么', `<div class="ssp-csws">${check('showDesc', '简介')}${check('showTags', '标签')}${check('showVer', '版本号')}${check('showStar', '收藏标记')}</div>`, true)}
        ${row('学生证', `<input class="text_pole ssp-cinput" data-ssp-card-text="school" value="${esc(c.school)}" placeholder="校名">
            <input type="text" class="text_pole ssp-cyear" data-ssp-card-text="year" value="${esc(c.year)}" placeholder="年份">
            <select class="text_pole ssp-cyear" data-ssp-card-select="idTheme" title="证件配色">${Object.keys(CARD_ID_THEMES)
            .map(k => `<option value="${k}"${c.idTheme === k ? ' selected' : ''}>${CARD_ID_THEMES[k].name}</option>`).join('')}</select>`, true)}
        </div>
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
    qbMount();                   // 快捷按钮托盘：跟着重画重挂一次（幂等）
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

/* ===== 扩展程序展开栏里的两个选项（v1.29.0）=====
   用户给的这份 HTML 就是真实结构：容器是 #extensionsMenu（点魔杖才出现），
   条目 = <div class="list-group-item flex-container flexGap5 interactable" role="listitem">
          + <div class="extensionsMenuExtensionButton">图标</div> + <span>文字</span>
   所以这里照抄那套写法，往 #extensionsMenu 里追加两条：
     ① 鼠鼠口袋（打开面板，球收着也能开）  ② 收回悬浮球
   栏是点开时才生成的，用定时器补挂（800ms 一次，没找到就直接返回）。 */
function mountPocketMenuEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById('ssp_menu_pocket')) return true;

    function mk(id, icon, text, title, fn) {
        const row = document.createElement('div');
        row.id = id;
        row.className = 'list-group-item flex-container flexGap5 interactable';
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'listitem');
        if (title) row.setAttribute('title', title);
        const ic = document.createElement('div');
        ic.className = 'fa-solid ' + icon + ' extensionsMenuExtensionButton';
        const sp = document.createElement('span');
        sp.textContent = text;
        row.append(ic, sp);
        row.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
        return row;
    }

    menu.append(mk('ssp_menu_pocket', 'fa-mouse', '鼠鼠口袋', '打开鼠鼠口袋面板（番外 / 面具 / 预设 / 美化 / 存档）', function () {
        try { openOrb(); } catch (e) { toast('打开鼠鼠口袋失败：' + e.message, 'warning'); }
    }));

    menu.append(mk('ssp_menu_retract', 'fa-eye-slash', '收回悬浮球', '把右下角那颗球收起来（之后还能用上面那条打开面板）', function () {
        getSettings().orbOn = false;
        try { save(); } catch (e) { }
        try { orbSetCollapsed(true, true); } catch (e) { }
        const b0 = document.getElementById('ssp_orb');
        if (b0) setTimeout(function () { try { b0.style.display = 'none'; } catch (e) { } }, 260);
        toast('球已收回；想放出来：鼠鼠面板里勾「显示悬浮球」', 'info');
    }));

    return true;
}
function bindPocketMenuEntry() {
    if (bindPocketMenuEntry.done) return false;
    bindPocketMenuEntry.done = true;
    mountPocketMenuEntry();
    try { setInterval(mountPocketMenuEntry, 800); } catch (e) { }
    return true;
}
/* ===== 扩展程序入口 结束 ===== */


/* ===== 高清头像：全站范围（放在块里，避免重构时被冲掉）=====
   把页面上所有 /thumbnail?type=avatar|persona&file=X 换成原图：
     avatar  → /characters/<file>      （酒馆自己的高清替换逻辑就用这个路径）
     persona → /User%20Avatars/<file>  （实测 HTTP 200）
   覆盖聊天气泡、角色列表、群聊、详情页。换完 src 不再匹配 /thumbnail?，不会自咬。
   开关：设置面板卡片样式里的「高清头像」。 */
function hdAvatarWanted() {
    try { const s = getSettings(); return !(s.card && s.card.hd === false); } catch (e) { return true; }
}
function hdSwapOne(img) {
    try {
        const src = img.getAttribute('src') || '';
        const m = /\/thumbnail\?[^#]*?type=(avatar|persona)[^#]*?[?&]file=([^&]+)/.exec(src);
        if (!m) return false;
        const file = decodeURIComponent(m[2]);
        if (!file) return false;
        const origin = (/type=persona/.test(src) ? '/User%20Avatars/' : '/characters/') + encodeURIComponent(file);
        /* ⚠️ 留个记号：src 被换掉之后，别的地方（比如面具切换）还得知道这是哪个文件 */
        try { img.dataset.sspFile = file; img.dataset.sspKind = (/type=persona/.test(src) ? 'persona' : 'avatar'); } catch (e) { }
        if (img.getAttribute('src') === origin) return false;
        img.setAttribute('src', origin);
        return true;
    } catch (e) { return false; }
}
function hdSwapAll(root) {
    if (!hdAvatarWanted()) return 0;
    const scope = root && root.querySelectorAll ? root : document;
    let n = 0;
    scope.querySelectorAll('img[src*="/thumbnail?"]').forEach(img => { if (hdSwapOne(img)) n += 1; });
    return n;
}
function bindHdAvatars() {
    if (bindHdAvatars.done) return false;
    bindHdAvatars.done = true;
    const n0 = hdSwapAll(document);
    try { window.__sspHdCount = n0; console.log('[鼠鼠小助手] 高清头像：初始替换 ' + n0 + ' 张（之后新出现的图会自动跟上）'); } catch (e) { }
    try {
        new MutationObserver(muts => {
            if (!hdAvatarWanted()) return;
            muts.forEach(mu => {
                /* ⚠️ 关键：酒馆常常"先插入 <img>、后设 src"，属性变化不走 childList；
                   About 版头那张大图就是这么被漏掉的（一直显示 96x144 的缩略图）。 */
                if (mu.type === 'attributes' && mu.target && mu.target.tagName === 'IMG') {
                    if (hdSwapOne(mu.target)) { try { window.__sspHdCount = (window.__sspHdCount || 0) + 1; } catch (e) { } }
                    return;
                }
                mu.addedNodes && mu.addedNodes.forEach(node => {
                    if (!node || node.nodeType !== 1) return;
                    if (node.tagName === 'IMG') hdSwapOne(node);
                    else if (node.querySelectorAll) {
                        const k = hdSwapAll(node);
                        if (k) { try { window.__sspHdCount = (window.__sspHdCount || 0) + k; } catch (e) { } }
                    }
                });
            });
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    } catch (e) { }
    return true;
}
/* ===== 高清头像 结束 ===== */

var orbBuilt = false;
/* 分类（文件夹）的「全部」标签值 —— 世界书和番外共用。
   ⚠️ 必须声明在下面几个 var 初始化之前，否则读它时会撞 TDZ（自己踩过）。 */
const ORB_CAT_ALL = '__all__';
var orbEdge = { right: 18, bottom: 96 };   // 球离右边/下边的距离（贴边靠它）
var orbOpenNow = false;
var orbEditing = null;
var orbTab = 'pick';         // 当前模块页（模块容器：以后加功能只加标签页）
/* ⚠️ 默认停在「选卡」：写卡/管卡是口袋现在的主线入口（用户要求把制作和写卡搬进来）。
   以前默认是番外，加页签后用户打开球会看到"不是自己刚加的那个"，容易以为没生效。 */
var orbBinding = null;      // 正在给哪个面具选绑定角色（null = 不在绑定模式）
var orbPersonaEdit = null;  // 正在编辑哪个面具（null = 不在编辑模式）
var orbPSearch = '';        // 面具页的搜索词（角色卡名 / 面具名 / 描述）
var orbPresetBinding = null;// 正在给哪个预设选绑定角色
var orbPreSearch = '';      // 预设页搜索词
var orbNSearch = '';        // 番外页搜索词
/* 番外分类（文件夹）：每条番外自己带 n.cat = '分类名'（'' 或没有 = 未分类） */
var orbNCat = ORB_CAT_ALL;  // 当前选中的分类标签
var orbNCatEdit = false;    // 是否展开「分类管理」
var orbNCatPick = null;     // 正在给哪条番外挑分类（n.id），null = 没在挑
var orbNCatNew = null;      // 正在给哪条番外「新建分类并归入」（就地输入框）
/** 把两页的「挑分类 / 新建分类」临时态一起清掉（切标签、点别处时用） */
function orbCatClearPickers() {
    orbWbCatPick = null; orbWbCatNew = null;
    orbNCatPick = null; orbNCatNew = null;
    orbDelConfirm = null;          // 顺手收掉"等确认删除"那一行，免得切页后还挂着
    orbPurgeConfirm = false;       // 「清空全部条目」的确认也一起收
}
var orbWbBinding = null;    // 正在给哪个角色卡配世界书（null = 不在绑定模式）
var orbWbSearch = '';       // 世界书页搜索词
/* 世界书分类（文件夹）：点标签只看那一类。
   ALL = 全部；'' = 未分类；其余 = 分类名。一本书最多归一个分类。
   （通用部分见下面 ORB_CAT_ALL / orbCatBarHTML） */
var orbWbCat = ORB_CAT_ALL;      // 当前选中的分类标签
var orbWbCatEdit = false;        // 是否展开「分类管理」（改名 / 删除）
var orbWbCatPick = null;         // 正在给哪本书挑分类（书名字符串），null = 没在挑
var orbWbCatNew = null;          // 正在给哪本书「新建分类并归入」（就地输入框）
var orbWbNames = [];        // 世界书名缓存（读不到就退回酒馆的 #world_info 下拉）
/* 世界书栏「展开某本书的条目」那一页的状态 */
var orbWbEntriesBook = '';  // 非空 = 正在看这本书的条目
var orbWbEntries = [];      // 缓存该书的条目
var orbWbEntriesLoaded = false;
var orbWbEntriesErr = '';
var orbWbEntryOpen = null;  // 正在编辑的 uid 或 'new'
var orbWbEntrySearch = '';
var orbWbEntryDraft = null; // 新建草稿
var orbDelConfirm = null;   // 正在等确认删除的条目 uid（就地确认，不用酒馆弹窗）
var orbPurgeConfirm = false; // DLC 栏「清空全部条目」是否在等确认
/* DLC 栏状态 */
var orbDlcSearch = '';
/* v1.31.59 「DLC 条目 ↔ 面具」用到的几个状态 */
var orbDlcFilter = 'all';      // 条目列表筛选：all | mask（只给面具的）| free（没绑的）
var orbDlcMaskFor = null;      // 正在给哪个条目挑面具（uid；null = 不在挑）
var dlcTempOff = new Set();    // 戴着面具时你手动"临时关"的条目（换面具 / 换聊天就清空）
var dlcWornCache = '';         // 从 PERSONA_CHANGED 事件里记下的当前面具（DOM 读不到时的兜底）
var orbCollapsed = false;   // 悬浮球是否收纳进左下角魔法棒

/* ============================ 背景图（绑定 + 统一管理） ============================
   分两半：
     ① 数据层 —— s.bgBinds（角色文件 → 背景文件名）、s.bgUser（"你自己的背景"，没绑的卡统一用它）、
        s.bgApplied（账本：我们在这个聊天里换过什么，用于恢复，绝不污染你手动选的）
     ② 面板页 —— 鼠鼠口袋「背景」页：列出全部背景 + 预览 + 当前标记 + 按卡绑定 + 上传/改名/删除/搜索

   酒馆那边换背景就两件事（对着 public/scripts/backgrounds.js 来的，不是猜的）：
     · 把 #bg1 的 background-image 设成 url("backgrounds/<encodeURIComponent(文件名)>")
     · 把 background_settings（上下文里的 ctx.background）里的 name/url 写回并保存
   ---------------------------------------------------------------------------- */
var orbBgList = [];          // [{ file }] 背景图列表
var orbBgLoading = false;
var orbBgSearch = '';
var orbBgDel = null;         // 等确认删除哪张背景
var orbBgUploading = false;

/** 背景文件名 → 酒馆用的 CSS url（照 getBackgroundPath 的规则编码） */
function orbBgUrl(file) {
    if (!file) return '';
    return 'url("backgrounds/' + encodeURIComponent(String(file)) + '")';
}
/** 当前真正生效的背景文件名（优先从 #bg1 上反解，最可靠） */
function orbBgNow() {
    try {
        const el = document.getElementById('bg1');
        const raw = el ? (el.style.backgroundImage || '') : '';
        const m = /backgrounds\/([^"')]+)/.exec(raw);
        if (m && m[1]) return decodeURIComponent(m[1]);
        const bg = getContext().background || {};
        return String(bg.name || '');
    } catch (e) { return ''; }
}
/** 你自己的背景（没绑背景的卡统一用它） */
function orbBgUser() {
    const s = getSettings();
    if (typeof s.bgUser !== 'string') s.bgUser = '';
    return s.bgUser;
}
function orbBgUserSet(file, persist) {
    getSettings().bgUser = String(file || '');
    if (persist) save();
}
function orbBgApplied() {
    const s = getSettings();
    if (!s.bgApplied || typeof s.bgApplied !== 'object') s.bgApplied = {};
    return s.bgApplied;
}
function orbBgChatKey() { return orbWbChatKey(); }   // 跟世界书栏同一套键：角色文件::聊天id

/** 换背景。file='' 表示回到"你自己的背景" */
function orbBgApply(file, quiet) {
    const want = String(file || '');
    try {
        const el = document.getElementById('bg1');
        if (el) el.style.backgroundImage = want ? orbBgUrl(want) : 'none';
        const ctx = getContext();
        if (ctx.background && typeof ctx.background === 'object') {
            ctx.background.name = want;
            ctx.background.url = want ? orbBgUrl(want) : '';
        }
        try { if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced(); } catch (e) { }
        save();
        if (!quiet) toast(want ? ('背景已换成：' + want) : '背景已切回你自己的那张', 'success');
        return true;
    } catch (e) {
        if (!quiet) toast('换背景失败：' + ((e && e.message) || e), 'warning');
        return false;
    }
}

/** 按当前角色卡的绑定对齐背景：绑了用绑的；没绑统一回到"你自己的背景"（你定的规则） */
function orbBgSyncChar(quiet) {
    try {
        const ch = orbWbCurChar();
        if (!ch) return { skipped: 'no-char' };
        const key = orbBgChatKey();
        const bound = String(orbBgBound(ch.key) || '');
        const now = orbBgNow();
        const ledger = orbBgApplied();
        const rec = key ? ledger[key] : null;
        const remember = v => {
            if (!key) return;
            ledger[key] = { ext: v, prev: (rec && rec.prev !== undefined) ? rec.prev : now, at: Date.now() };
            save();
        };
        if (bound) {
            if (now !== bound) orbBgApply(bound, !!quiet);
            remember(bound);
            return { now: bound, bound: bound, changed: now !== bound };
        }
        /* 没绑 → 用「你自己的背景」。
           ⚠️ 「你的背景」**只由你点那个按钮来记**，绝不在这里从"当前这张"回填 ——
              酒馆换卡时会自己套这张卡的背景，一回填就把你的记录污染成别人的图了（真机 e2e 抓到过）。 */
        const mine = orbBgUser();
        if (rec) { delete ledger[key]; save(); }                        // 之前是我们换的 → 收回记账
        if (!mine) return { now: now, bound: '', changed: false, kept: 'no-user-bg' };  // 没记过 → 不动，保持酒馆自己那套
        if (now === mine) return { now: now, bound: '', changed: false };
        orbBgApply(mine, !!quiet);
        return { now: mine, bound: '', changed: now !== mine };
    } catch (e) {
        return { error: String((e && e.message) || e) };
    }
}

/** 当前角色卡绑的背景文件名 */
function orbBgBound(charKey) {
    const s = getSettings();
    if (!s.bgBinds || typeof s.bgBinds !== 'object') s.bgBinds = {};
    const v = s.bgBinds[String(charKey || '')];
    return typeof v === 'string' ? v : '';
}
/** 绑定 / 换一张（file='' 解绑） */
function orbBgSetBind(file) {
    const ch = orbWbCurChar();
    if (!ch) { toast('先在酒馆里打开一张角色卡', 'warning'); return false; }
    const s = getSettings();
    if (!s.bgBinds || typeof s.bgBinds !== 'object') s.bgBinds = {};
    const want = String(file || '');
    if (want) s.bgBinds[ch.key] = want; else delete s.bgBinds[ch.key];
    save();
    const r = orbBgSyncChar(true);
    toast(want ? ('已给《' + ch.name + '》绑定背景：' + want) : ('已解绑《' + ch.name + '》的背景'), 'success');
    return r;
}

/** 拉全部背景图 */
async function orbBgFetch() {
    orbBgLoading = true;
    if (orbOpenNow && orbTab === 'bg') renderOrbPanel();
    try {
        const d = await orbDataPost('/api/backgrounds/all', {});
        orbBgList = orbDataArr(d).map(x => ({ file: orbDataNameOf(x, '') })).filter(x => x.file);
        /* 「你自己的背景」不在这里偷偷回填 —— 由面板上那个按钮负责（见 orbBgSyncChar 的注释） */
    } catch (e) {
        orbBgList = [];
        toast('读背景图列表失败：' + ((e && e.message) || e), 'warning');
    }
    orbBgLoading = false;
    if (orbOpenNow && orbTab === 'bg') renderOrbPanel();
    return orbBgList;
}
/** 上传一张背景图（走酒馆自己的接口） */
async function orbBgUpload(file) {
    if (!file) return null;
    orbBgUploading = true;
    if (orbOpenNow && orbTab === 'bg') renderOrbPanel();
    try {
        const ctx = getContext() || {};
        const fd = new FormData();
        fd.append('avatar', file, file.name || 'bg.png');
        const r = await fetch('/api/backgrounds/upload', {
            method: 'POST',
            headers: ctx.getRequestHeaders ? ctx.getRequestHeaders({ omitContentType: true }) : {},
            body: fd,
        });
        if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + ' ' + String(t).slice(0, 80)); }
        const d = await r.json().catch(() => ({}));
        const name = String((d && (d.name || d.path || d.filename)) || '').split('/').pop();
        toast('背景图已上传：' + (name || file.name), 'success');
        await orbBgFetch();
        return name || null;
    } catch (e) {
        toast('上传失败：' + ((e && e.message) || e), 'warning');
        return null;
    } finally {
        orbBgUploading = false;
        if (orbOpenNow && orbTab === 'bg') renderOrbPanel();
    }
}
/** 改名（走酒馆接口，它自己清洗非法字符）；绑定/账本/你的背景里同名的一起跟着改 */
async function orbBgRenameTo(oldName, newName) {
    const ctx = getContext() || {};
    try {
        const r = await fetch('/api/backgrounds/rename', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, ctx.getRequestHeaders ? ctx.getRequestHeaders() : {}),
            body: JSON.stringify({ old_bg: oldName, new_bg: newName }),
            cache: 'no-cache',
        });
        if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + ' ' + String(t).slice(0, 60)); }
        const d = await r.json().catch(() => ({}));
        const finalName = String((d && (d.bg || d.new_bg)) || newName);
        const s = getSettings();
        if (s.bgBinds) Object.keys(s.bgBinds).forEach(k => { if (s.bgBinds[k] === oldName) s.bgBinds[k] = finalName; });
        if (s.bgUser === oldName) s.bgUser = finalName;
        const ledger = orbBgApplied();
        Object.keys(ledger).forEach(k => { if (ledger[k] && ledger[k].ext === oldName) ledger[k].ext = finalName; });
        save();
        if (orbBgNow() === oldName) orbBgApply(finalName, true);
        toast('已改名：' + oldName + ' → ' + finalName, 'success');
        await orbBgFetch();
        return finalName;
    } catch (e) {
        toast('改名失败：' + ((e && e.message) || e), 'warning');
        return null;
    }
}
/** 删一张背景图（同时清掉所有指向它的绑定） */
async function orbBgDelete(file) {
    const ctx = getContext() || {};
    const nm = String(file || '');
    if (!nm) return false;
    try {
        const r = await fetch('/api/backgrounds/delete', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, ctx.getRequestHeaders ? ctx.getRequestHeaders() : {}),
            body: JSON.stringify({ bg: nm }),
            cache: 'no-cache',
        });
        if (!r.ok && r.status !== 404) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + ' ' + String(t).slice(0, 60)); }
        const s = getSettings();
        if (s.bgBinds) Object.keys(s.bgBinds).forEach(k => { if (s.bgBinds[k] === nm) delete s.bgBinds[k]; });
        if (s.bgUser === nm) s.bgUser = '';
        const ledger = orbBgApplied();
        Object.keys(ledger).forEach(k => { if (ledger[k] && ledger[k].ext === nm) delete ledger[k]; });
        save();
        if (orbBgNow() === nm) orbBgApply(orbBgUser(), true);
        toast('已删除背景图：' + nm + '（相关绑定一起清了）', 'success');
        await orbBgFetch();
        return true;
    } catch (e) {
        toast('删除失败：' + ((e && e.message) || e), 'warning');
        return false;
    }
}

/** 「背景」页的列表（搜的时候只换这一块，输入框不丢焦点） */
function orbBgRowsHTML() {
    const ch = orbWbCurChar();
    const cur = orbBgNow();
    const bound = ch ? orbBgBound(ch.key) : '';
    const q = orbBgSearch.toLowerCase();
    const hit = orbBgList.filter(b => !q || b.file.toLowerCase().indexOf(q) >= 0);
    const head = orbBgSearch ? '<div class="ssp-orb-pcount">筛选出 ' + hit.length + ' / ' + orbBgList.length + ' 张</div>' : '';
    if (!orbBgList.length) return head + '<div class="ssp-orb-empty">一张背景图都没有（酒馆里「背景」那页传一张就会出现在这）。</div>';
    if (!hit.length) return head + '<div class="ssp-orb-empty">没有匹配「' + esc(orbBgSearch) + '」的背景图。</div>';
    const rows = hit.map(b => {
        const on = (b.file === cur), bind = (b.file === bound);
        return '<div class="ssp-orb-prow' + (on ? ' on' : '') + '">'
            + '<img class="ssp-orb-pav" src="/backgrounds/' + encodeURIComponent(b.file) + '" loading="lazy"'
            + ' data-orb-bg="' + esc(b.file) + '" title="点一下换成这张（等于用酒馆自己切）" alt="">'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(b.file)
            + (on ? '<span class="ssp-orb-ptag">当前</span>' : '')
            + (bind ? '<span class="ssp-orb-ptag">本卡绑定</span>' : '') + '</div>'
            + '</div>'
            + '<div class="ssp-orb-pacts">'
            + '<span class="ssp-pbtn' + (on ? ' primary' : '') + '" data-orb-bg="' + esc(b.file) + '">' + (on ? '当前' : '换成这张') + '</span>'
            + '<span class="ssp-pbtn' + (bind ? ' primary' : '') + '" data-orb-bgbind="' + esc(b.file) + '">' + (bind ? '已绑这张' : '绑给本卡') + '</span>'
            + '<span class="ssp-pbtn" data-orb-bgren="' + esc(b.file) + '" title="改名">✏</span>'
            + '<span class="ssp-pbtn danger" data-orb-bgdel="' + esc(b.file) + '" title="删除这张背景图（会先问一次）">🗑</span>'
            + '</div></div>'
            + (String(orbBgDel) === String(b.file)
                ? '<div class="ssp-en-confirm">'
                + '<span class="ssp-en-confirm-t">删掉背景图「' + esc(b.file) + '」？<b>文件一起删</b>，绑着它的卡会一起解绑。</span>'
                + '<span class="ssp-pbtn danger" data-orb-bgdelgo="' + esc(b.file) + '"><i class="fa-solid fa-trash"></i>确认删掉</span>'
                + '<span class="ssp-pbtn" data-orb-bgdelcancel="1">算了</span>'
                + '</div>'
                : '');
    }).join('');
    return head + '<div class="ssp-orb-plist">' + rows + '</div>';
}

function orbBgHTML() {
    const ch = orbWbCurChar();
    const cur = orbBgNow();
    const bound = ch ? orbBgBound(ch.key) : '';
    const mine = orbBgUser();
    const auto = getSettings().bgAuto !== false;
    let h = '<div class="ssp-orb-pfilter"><i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-bgsearch="1" placeholder="搜背景图名" value="' + esc(orbBgSearch) + '">'
        + (orbBgSearch ? '<span class="ssp-pbtn" data-orb-bgclear="1">清除</span>' : '')
        + '</div>';
    h += '<div class="ssp-orb-empty" style="padding:2px 0 6px">'
        + (ch
            ? ('角色：<b>' + esc(ch.name) + '</b>；本卡绑定：<b>' + esc(bound || '（没绑 → 用你自己的背景）') + '</b>；当前生效：<b>' + esc(cur || '（无）') + '</b>')
            : '先在酒馆里打开一张角色卡，这里才会显示"本卡绑定"。')
        + '<br>你自己的背景：<b>' + esc(mine || '（还没记下来）') + '</b>'
        + '　<span class="ssp-orb-auto"><input type="checkbox" data-orb-bgauto="1"' + (auto ? ' checked' : '') + '>'
        + '<label>换角色自动切背景</label></span></div>';
    if (orbBgLoading) h += '<div class="ssp-orb-empty">正在读背景图…</div>';
    else h += '<div id="ssp_orb_bglist">' + orbBgRowsHTML() + '</div>';
    h += '<div class="ssp-orb-foot">'
        + '<span class="ssp-pbtn primary" data-orb-bgupload="1">' + (orbBgUploading ? '上传中…' : '＋ 上传背景图') + '</span>'
        + '<span class="ssp-pbtn" data-orb-bgrefresh="1"><i class="fa-solid fa-rotate"></i>刷新</span>'
        + (bound ? '<span class="ssp-pbtn" data-orb-bgunbind="1">解绑本卡</span>' : '')
        + '<span class="ssp-pbtn" data-orb-bguser="1" title="把现在生效的这张记成「你自己的背景」（没绑背景的卡都用它）">把当前这张记成我的</span>'
        + '</div>'
        + '<input type="file" accept="image/*" data-orb-bgfile="1" style="display:none">'
        + '<div class="ssp-orb-empty" style="padding-top:6px">点缩略图或「换成这张」= 直接换背景（跟酒馆自己换一个效果）；'
        + '「绑给本卡」= 以后切到这张卡自动换；没绑的卡一律用「你自己的背景」。</div>';
    return h;
}

/* ============================ 调试窗（脚本测试 / 一键诊断 / 抓元素） ============================
   为什么要它：手机和电脑显示不一致时，最烦的是"没法在手机上现场跑段代码看看"，
   而导入脚本又麻烦。这里给一个窗口，直接在酒馆页面里跑脚本、看结果、复制结果发出去 ——
   手机端不用导入任何文件，刷新就能用。
   可行性已实测（无头浏览器探针）：new Function / eval 可用、页面**没有 CSP meta**、
   样式表 118 张 9308 条规则**零跨域拦截**、matchMedia / CSS.supports / getComputedStyle /
   visualViewport / env(safe-area-inset-*) 全都在。
   ---------------------------------------------------------------------------- */
var orbDbgOpen = false;        // 窗口开着吗
var orbDbgCode = '';           // 当前脚本内容
var orbDbgOut = [];            // 输出区（字符串数组，方便整体复制）
var orbDbgName = '';           // 当前脚本名（存脚本用）
var orbDbgBusy = false;
var orbDbgTab = 'script';      // script / diag / pick
var orbDbgPick = false;        // 是否正在抓元素
var orbDbgPendEl = null;       // 手机上"已经框住、等第二下确认"的那个元素（桌面不用）
var orbDbgPickEl = null;       // 抓到的元素 —— 用模块变量存（页签内容每次重画，挂在 DOM 上会丢）
var orbDbgSeq = 0;             // 输出区里第几条记录（画分割线用，清空时归零）

function orbDbgStore() {
    const s = getSettings();
    if (!Array.isArray(s.dbgScripts)) s.dbgScripts = [];
    return s.dbgScripts;
}
/** 把任意值变成能看、能复制的文本 */
function orbDbgFmt(v, depth) {
    const d = depth || 0;
    try {
        if (v === undefined) return 'undefined';
        if (v === null) return 'null';
        const t = typeof v;
        if (t === 'string') return d ? JSON.stringify(v) : v;
        if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
        if (t === 'function') return 'ƒ ' + (v.name || '') + '()';
        if (v.nodeType && v.tagName) {
            let sel = String(v.tagName).toLowerCase();
            if (v.id) sel += '#' + v.id;
            const cls = (typeof v.className === 'string') ? v.className.trim() : '';
            if (cls) sel += '.' + cls.split(/\s+/).slice(0, 3).join('.');
            return '<' + sel + '>';
        }
        if (d >= 2) return Array.isArray(v) ? '[…' + v.length + ']' : '{…}';
        if (Array.isArray(v)) return '[' + v.slice(0, 30).map(x => orbDbgFmt(x, d + 1)).join(', ') + (v.length > 30 ? ', …共' + v.length + ' 个' : '') + ']';
        const keys = Object.keys(v);
        return '{' + keys.slice(0, 24).map(k => k + ': ' + orbDbgFmt(v[k], d + 1)).join(', ')
            + (keys.length > 24 ? ', …共' + keys.length + ' 个键' : '') + '}';
    } catch (e) { return '(显示不了: ' + e.message + ')'; }
}
function orbDbgSay(line) {
    orbDbgOut.push(String(line === undefined ? '' : line));
    if (orbDbgOut.length > 500) orbDbgOut.splice(0, orbDbgOut.length - 500);
    orbDbgPaint();
}
function orbDbgClear() { orbDbgOut = []; orbDbgSeq = 0; orbDbgPaint(); }
function orbDbgText() { return orbDbgOut.join('\n'); }
/* 每条记录之间用等宽分割线隔开（用户要求：不然不知道"从哪到哪是这一次的"）。
   每条开头一条线 + 序号 + 时间戳 + 来源符号：▶ 运行 · ⚙ 诊断 · ⌖ 抓取。
   （只需要开头这条：下一条的线天然就是上一条的结束边界。） */
function orbDbgRule(icon, title) {
    orbDbgSeq = (orbDbgSeq || 0) + 1;
    const t = new Date().toLocaleTimeString();
    orbDbgOut.push('');
    orbDbgOut.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    orbDbgOut.push('  ' + icon + '  ' + title + '   #' + orbDbgSeq + ' · ' + t);
    orbDbgOut.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    orbDbgPaint();
}
function orbDbgDivider(title) {
    orbDbgSay('');
    orbDbgSay('──── ' + title + ' ────');
}

/** 跑一段脚本：拦 console、抓返回值、抓报错（带回溯行） */
async function orbDbgRun(code) {
    const src = String(code === undefined || code === null ? orbDbgCode : code);
    if (!src.trim()) { orbDbgSay('（脚本是空的）'); return null; }
    orbDbgBusy = true;
    orbDbgRule('▶', '运行脚本');
    const logged = [];
    const keep = {};
    ['log', 'info', 'warn', 'error'].forEach(k => {
        keep[k] = console[k];
        console[k] = function () {
            const line = Array.prototype.slice.call(arguments).map(a => orbDbgFmt(a, 1)).join(' ');
            logged.push(k.toUpperCase() + ' ' + line);
            orbDbgSay('  ' + k.toUpperCase() + ' ' + line);
            try { keep[k].apply(console, arguments); } catch (e) { }
        };
    });
    let result, err = null;
    const t0 = Date.now();
    try {
        /* 包成 async IIFE：脚本里能写 await、也能 return 交回结果。
           第一个参数是 `el` —— 抓元素抓到的那个（没抓过就是 null），
           所以抓完可以直接写 el.xxx 继续查它。 */
        const picked = orbDbgPickEl || null;
        const fn = new Function('el', '"use strict"; return (async () => {\n' + src + '\n})();');
        result = await fn(picked);
    } catch (e) {
        err = e;
    } finally {
        ['log', 'info', 'warn', 'error'].forEach(k => { console[k] = keep[k]; });
        orbDbgBusy = false;
    }
    if (err) {
        orbDbgSay('✗ ' + (err && err.name ? err.name + ': ' : '') + ((err && err.message) || err));
        try {
            String(err.stack || '').split('\n').filter(l => /anonymous|eval/.test(l)).slice(0, 2)
                .forEach(l => orbDbgSay('    在 ' + l.trim()));
        } catch (e) { }
    } else {
        orbDbgSay('← 返回：' + orbDbgFmt(result, 1));
    }
    orbDbgSay('（用时 ' + (Date.now() - t0) + 'ms' + (logged.length ? '，console ' + logged.length + ' 条' : '') + '）');
    orbDbgPaint();
    return err ? null : result;
}

/* ---------------------------- 一键诊断 ---------------------------- */
function orbDbgDiagScreen() {
    const lines = [];
    const vv = window.visualViewport || null;
    lines.push('视口 innerWidth×innerHeight：' + window.innerWidth + ' × ' + window.innerHeight);
    lines.push('屏幕 screen：' + screen.width + ' × ' + screen.height + '（可用 ' + screen.availWidth + '×' + screen.availHeight + '）');
    lines.push('devicePixelRatio：' + window.devicePixelRatio);
    if (vv) lines.push('visualViewport：' + Math.round(vv.width) + ' × ' + Math.round(vv.height) + '（offsetTop ' + Math.round(vv.offsetTop) + '，scale ' + vv.scale + '）');
    lines.push('UA：' + navigator.userAgent);
    lines.push('平台：' + (navigator.platform || '?') + '　语言：' + navigator.language);
    lines.push('触摸：ontouchstart=' + ('ontouchstart' in window) + '　maxTouchPoints=' + navigator.maxTouchPoints + '　pointer:' + (window.PointerEvent ? 'PointerEvent' : '无'));
    lines.push('横竖屏：' + (window.innerWidth > window.innerHeight ? '横屏' : '竖屏') + '　orientation=' + (screen.orientation ? screen.orientation.type : '?'));
    try {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden';
        document.body.appendChild(probe);
        const cs = getComputedStyle(probe);
        lines.push('安全区：top=' + (cs.paddingTop || '0') + ' bottom=' + (cs.paddingBottom || '0'));
        probe.remove();
    } catch (e) { lines.push('安全区：读不到（' + e.message + '）'); }
    try {
        const d = document.documentElement;
        lines.push('文档滚动高度：' + d.scrollHeight + '　body 高度：' + (document.body ? document.body.scrollHeight : '?'));
        lines.push('缩放：' + (Math.round((window.outerWidth / window.innerWidth) * 100) / 100) + '　standalone=' + (window.matchMedia('(display-mode: standalone)').matches ? '是' : '否'));
    } catch (e) { }
    return lines.join('\n');
}
function orbDbgDiagMedia() {
    const q = [
        ['pointer: coarse（手指）', '(pointer: coarse)'],
        ['pointer: fine（鼠标）', '(pointer: fine)'],
        ['hover: none（不能悬停）', '(hover: none)'],
        ['hover: hover', '(hover: hover)'],
        ['any-pointer: coarse', '(any-pointer: coarse)'],
        ['深色模式', '(prefers-color-scheme: dark)'],
        ['减少动效', '(prefers-reduced-motion: reduce)'],
        ['横屏', '(orientation: landscape)'],
        ['竖屏', '(orientation: portrait)'],
        ['≤480px', '(max-width: 480px)'],
        ['≤600px', '(max-width: 600px)'],
        ['≤768px', '(max-width: 768px)'],
        ['≤900px', '(max-width: 900px)'],
        ['≤1024px', '(max-width: 1024px)'],
        ['≥1025px', '(min-width: 1025px)'],
    ];
    const lines = ['媒体查询体检（真=命中这一支）：'];
    q.forEach(pair => {
        let yes = '?';
        try { yes = window.matchMedia(pair[1]).matches ? '真 ✓' : '假'; } catch (e) { yes = '不支持'; }
        lines.push('  ' + (yes === '真 ✓' ? '✓' : ' ') + ' ' + pair[0] + '  ' + pair[1] + '  → ' + yes);
    });
    return lines.join('\n');
}
function orbDbgDiagCss() {
    const feats = [
        ':has()', 'selector(:has(*))',
        'aspect-ratio: 1', 'inset: 0', 'gap: 1px',
        'height: 100dvh', 'height: 100svh', 'height: 100lvh',
        'color: color-mix(in srgb, red, blue)',
        'backdrop-filter: blur(2px)', '-webkit-backdrop-filter: blur(2px)',
        'width: min(1px, 2px)', 'width: clamp(1px, 2px, 3px)',
        'padding: env(safe-area-inset-top)',
        'position: sticky', 'display: grid', 'display: flex',
        'grid-template-columns: subgrid',
        'accent-color: red', 'text-wrap: balance', 'overflow: clip',
    ];
    const lines = ['CSS 特性支持检测：'];
    feats.forEach(f => {
        let ok = '?';
        try { ok = CSS.supports(f) ? '支持 ✓' : '不支持 ✗'; } catch (e) { ok = '测不了'; }
        lines.push('  ' + (ok === '支持 ✓' ? '✓' : '✗') + ' ' + f + '  → ' + ok);
    });
    return lines.join('\n');
}
function orbDbgDiagState() {
    const lines = ['扩展状态快照：'];
    try {
        const s = getSettings();
        lines.push('  版本：v' + PANEL_VERSION + '　设备：' + activeDevice() + '　面板开着：' + orbOpenNow);
        lines.push('  悬浮球：' + (s.orbOn === false ? '关' : '开') + '　已收起：' + (s.orbCollapsed === true ? '是' : '否'));
        lines.push('  世界书自动：' + (s.worldAuto !== false) + '　美化自动：' + (s.presetAuto !== false) + '　背景自动：' + (s.bgAuto !== false));
        const cnt = o => (o && typeof o === 'object') ? Object.keys(o).length : 0;
        lines.push('  绑定表：世界书 ' + cnt(s.worldBinds) + ' 个 / 美化 ' + cnt(s.themeBinds) + ' 个 / 预设 ' + cnt(s.presetBinds) + ' 个 / 背景 ' + cnt(s.bgBinds) + ' 个');
        lines.push('  你自己的背景：' + (s.bgUser || '（没记）'));
        lines.push('  番外 ' + cnt(s.notes) + ' 条　存档记录 ' + cnt(s.worldApplied) + ' 条');
    } catch (e) { lines.push('  读设置失败：' + e.message); }
    try {
        const ctx = getContext() || {};
        const ch = (ctx.characters || [])[ctx.characterId];
        lines.push('  当前角色：' + (ch ? ch.name + '（' + ch.avatar + '）' : '（没打开）'));
        lines.push('  当前聊天：' + ((ctx.getCurrentChatId && ctx.getCurrentChatId()) || '（无）'));
        lines.push('  消息条数：' + ((ctx.chat && ctx.chat.length) || 0));
        lines.push('  酒馆版本：' + ((ctx.version) || '?'));
    } catch (e) { lines.push('  读上下文失败：' + e.message); }
    try {
        const enabled = Array.from(document.querySelectorAll('#extensions_settings .extension_container, .extension_container'))
            .map(el => (el.querySelector('.inline-drawer-toggle, b, h4') || {}).textContent || '').map(t => t.trim()).filter(Boolean);
        lines.push('  扩展条目（DOM 里能看到的）：' + (enabled.length ? enabled.slice(0, 14).join('、') : '（没读到）'));
    } catch (e) { }
    lines.push('  高清头像替换：' + (document.querySelectorAll('img[data-ssp-hd]').length || 0) + ' 张');
    return lines.join('\n');
}

/* ---------------------------- 窗口本体 ---------------------------- */
/** 调试 UI 的根节点 —— 现在是鼠鼠口袋里的一个页签内容（只在停在该页时存在） */
function orbDbgEl() { return document.getElementById('ssp_dbg'); }

/* 抓元素用的高亮框：F12 那种"指着谁就框谁"。
   pointer-events:none 才不会挡住选取（否则 elementFromPoint 永远只拿到它自己）。 */
function orbDbgHl() {
    let h = document.getElementById('ssp_dbg_hl');
    if (!h) {
        h = document.createElement('div');
        h.id = 'ssp_dbg_hl';
        document.body.appendChild(h);
    }
    return h;
}
function orbDbgTagOf(el) {
    try {
        let s = String((el && el.tagName) || '').toLowerCase();
        if (el && el.id) s += '#' + el.id;
        const cls = (el && typeof el.className === 'string') ? el.className.trim() : '';
        if (cls) s += '.' + cls.split(/\s+/).slice(0, 2).join('.');
        return s || '(未知)';
    } catch (e) { return '(未知)'; }
}
function orbDbgHlShow(el) {
    try {
        const h = orbDbgHl();
        if (!el || !el.getBoundingClientRect || (el.closest && el.closest('#ssp_dbg, #ssp_dbg_pick, #ssp_dbg_hl'))) {
            h.style.display = 'none'; return;
        }
        const r = el.getBoundingClientRect();
        h.style.display = 'block';
        h.style.left = Math.round(r.left) + 'px';
        h.style.top = Math.round(r.top) + 'px';
        h.style.width = Math.max(1, Math.round(r.width)) + 'px';
        h.style.height = Math.max(1, Math.round(r.height)) + 'px';
        const lab = document.getElementById('ssp_dbg_hl_lab');
        if (lab) lab.textContent = orbDbgTagOf(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    } catch (e) { }
}
function orbDbgHlHide() {
    const h = document.getElementById('ssp_dbg_hl');
    if (h) h.style.display = 'none';
}
function orbDbgPickTip(text) {
    const box = document.getElementById('ssp_dbg_pick');
    const b = box && box.querySelector('b');
    if (b && text) b.textContent = text;
}
/** 手指/鼠标底下的元素（高亮框 pointer-events:none，所以能拿到真元素） */
function orbDbgUnder(ev) {
    try {
        if (ev.touches && ev.touches[0]) return document.elementFromPoint(ev.touches[0].clientX, ev.touches[0].clientY) || ev.target;
        if (ev.changedTouches && ev.changedTouches[0]) return document.elementFromPoint(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY) || ev.target;
    } catch (e) { }
    return ev.target;
}
/* 预览（移动）：桌面 mousemove、手机 touchmove —— 都不确认，只挪框 */
function orbDbgPickMove(ev) {
    if (!orbDbgPick) return;
    const el = orbDbgUnder(ev);
    if (!el) return;
    if (el.closest && el.closest('#ssp_dbg, #ssp_dbg_pick')) return;
    if (ev.cancelable) ev.preventDefault();
    orbDbgHlShow(el);
    /* 手机：手指划到别处了 → 清掉"待确认"，免得划完随手一抬就误抓 */
    if (ev.touches) orbDbgPendEl = (orbDbgPendEl === el) ? orbDbgPendEl : null;
}
function orbDbgPickOff() {
    const h = document.getElementById('ssp_dbg_hl');
    if (h) h.remove();
    if (!orbDbgPick) return;
    orbDbgPick = false;
    orbDbgPendEl = null;
    const box = document.getElementById('ssp_dbg_pick');
    if (box) box.remove();
    document.removeEventListener('touchstart', orbDbgPickHandler, true);
    document.removeEventListener('touchmove', orbDbgPickMove, true);
    document.removeEventListener('mousedown', orbDbgPickHandler, true);
    document.removeEventListener('mousemove', orbDbgPickMove, true);
}
function orbDbgPickHandler(ev) {
    if (!orbDbgPick) return;
    const isTouch = !!ev.touches;
    const t = orbDbgUnder(ev);
    if (!t || (t.closest && t.closest('#ssp_dbg, #ssp_dbg_pick'))) return;     // 别抓调试窗自己
    ev.preventDefault();
    ev.stopPropagation();
    /* 手机：第一下只画框（预览），**再点同一个**才确认 —— 用户要求的"点一次出现颜色框、再点一遍"。
       桌面有 hover，所以点一下就直接确认。 */
    if (isTouch && orbDbgPendEl !== t) {
        orbDbgPendEl = t;
        orbDbgHlShow(t);
        orbDbgPickTip('已框住 ' + orbDbgTagOf(t) + ' —— 再点它一下确认（点别处就换目标）');
        return;
    }
    orbDbgPendEl = null;
    const sel = orbDbgSelectorOf(t);
    orbDbgPickOff();
    orbDbgTab = 'pick';
    orbDbgOpenWin();                       // 切回「调试」页签（顺便重画，输出区才看得到）
    /* 把抓到的元素记在模块变量上 —— 之后在主脚本框里直接用 `el` 指它就能跑代码
       （这样不用再加一套"元素专用脚本框"的 UI，手机上少一个要学的按钮） */
    orbDbgPickEl = t;
    orbDbgRule('⌖', '抓元素');
    orbDbgSay('抓到了：' + sel);
    orbDbgSay(orbDbgInspect(t));
    orbDbgSay('');
    orbDbgSay('▶ 现在可以在上面的脚本框里直接用 `el` 指它了，例如：');
    orbDbgSay('    return { 宽: el.getBoundingClientRect().width, 显示: getComputedStyle(el).display, 父: el.parentElement && el.parentElement.tagName };');
    orbDbgSay('  然后点「运行」。（再抓一次，el 就换成新的那个）');
    getSettings().dbgLastPick = sel;
    save();
    orbDbgPaint();
}
/** 给元素生成一个尽量稳、能直接往 CSS 里粘的选择器 */
function orbDbgSelectorOf(el) {
    try {
        if (!el || !el.tagName) return '';
        if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + el.id;
        const parts = [];
        let cur = el;
        while (cur && cur.tagName && cur !== document.body && parts.length < 6) {
            let part = String(cur.tagName).toLowerCase();
            const cls = (typeof cur.className === 'string' ? cur.className.trim() : '').split(/\s+/)
                .filter(c => c && !/^(on|off|active|hover|selected)$/.test(c)).slice(0, 3);
            if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
            /* 同层同签名的第几个 */
            const sibs = cur.parentElement ? Array.from(cur.parentElement.children).filter(s => s.tagName === cur.tagName) : [cur];
            if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
            parts.unshift(part);
            const cand = parts.join(' > ');
            try { if (document.querySelectorAll(cand).length === 1) return cand; } catch (e) { }
            cur = cur.parentElement;
        }
        return parts.join(' > ') || String(el.tagName).toLowerCase();
    } catch (e) { return String((el && el.tagName) || '').toLowerCase(); }
}
/** 元素体检：计算样式 / 盒模型 / 父链 / 命中的规则（关键项） */
function orbDbgInspect(el) {
    const L = [];
    try {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        L.push('  尺寸：' + Math.round(r.width) + ' × ' + Math.round(r.height) + '　位置 left ' + Math.round(r.left) + ' top ' + Math.round(r.top));
        L.push('  盒模型：内容 ' + Math.round(r.width) + '×' + Math.round(r.height)
            + '　padding ' + cs.paddingTop + '/' + cs.paddingRight + '/' + cs.paddingBottom + '/' + cs.paddingLeft
            + '　margin ' + cs.marginTop + '/' + cs.marginRight + '/' + cs.marginBottom + '/' + cs.marginLeft);
        const keys = ['display', 'visibility', 'opacity', 'position', 'z-index', 'overflow', 'flex', 'gap',
            'width', 'height', 'min-width', 'max-width', 'font-size', 'line-height', 'color', 'background-color',
            'background-image', 'border-radius', 'transform', 'backdrop-filter'];
        L.push('  计算样式：');
        keys.forEach(k => { const v = cs.getPropertyValue(k); if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px') L.push('    ' + k + ': ' + v); });
        /* 命中的规则（同源样式表全可枚举；最后几条通常就是"压住你的那位"） */
        const hits = [];
        for (let i = 0; i < document.styleSheets.length; i++) {
            let rules = null;
            try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
            if (!rules) continue;
            for (let j = 0; j < rules.length; j++) {
                const rule = rules[j];
                if (!rule || !rule.selectorText) continue;
                const sel = rule.selectorText;
                if (sel.indexOf('#ssp_dbg') >= 0) continue;
                let ok = false;
                try { ok = el.matches(sel); } catch (e) { ok = false; }
                if (ok) hits.push(sel);
            }
        }
        L.push('  命中规则：' + hits.length + ' 条');
        hits.slice(-12).forEach(s => L.push('    ' + s));
        if (hits.length > 12) L.push('    （只列最后 12 条，通常最后几条就是压住你的那个）');
        /* 图片为什么没显示 */
        if (el.tagName === 'IMG') L.push('  图片：naturalWidth=' + el.naturalWidth + '（0 = 根本没加载出来）　src=' + String(el.src).slice(0, 120));
        const bg = cs.backgroundImage;
        if (bg && bg !== 'none') L.push('  背景图：' + bg.slice(0, 140));
    } catch (e) { L.push('  体检出错：' + e.message); }
    return L.join('\n');
}

/** 调试 UI 的 HTML —— 它是**鼠鼠口袋里的一个页签**（不另外开窗）。
    ⚠️ 历史：以前是一个 position:fixed 的独立窗口（#ssp_dbg），照口袋内容区的矩形摆，
       手机上那个矩形常超出视口 → 窗口跑到屏幕外、按钮也点不到（用户反馈
       "调试面板完全移位了、相关都关不掉"）。现在直接做进面板当页签：
       跟随面板布局、跟随面板滚动，再也没有对不齐的问题。
       抓元素模式仍然用两个 fixed 的小浮层（#ssp_dbg_pick 提示条 / #ssp_dbg_hl 高亮框）——
       那两个本来就要盖在页面元素上，是正常设计。 */
function orbDbgHTML() {
    const pre = orbDbgText();
    return '<div class="ssp-dbgwrap" id="ssp_dbg">'
        + '<div class="ssp-dbg-bar">'
        + '<span class="ssp-pbtn' + (orbDbgTab === 'script' ? ' primary' : '') + '" data-ssp-dbgtab="script"><i class="fa-solid fa-terminal"></i> 脚本</span>'
        + '<span class="ssp-pbtn' + (orbDbgTab === 'diag' ? ' primary' : '') + '" data-ssp-dbgtab="diag"><i class="fa-solid fa-stethoscope"></i> 诊断</span>'
        + '<span class="ssp-pbtn' + (orbDbgTab === 'pick' ? ' primary' : '') + '" data-ssp-dbgtab="pick"><i class="fa-solid fa-crosshairs"></i> 抓元素</span>'
        + '</div>'
        + (orbDbgTab === 'pick'
            ? '<div class="ssp-dbgnote">点下面的「开始抓取」，然后指着（手机上划到）页面上的元素 —— '
                + '会画框、点一下预览、再点一下确认。<br>抓到的元素在脚本里就是变量 <b>el</b>。</div>'
                + '<div class="ssp-dbg-bar"><span class="ssp-pbtn primary" data-ssp-dbgpickstart="1">'
                + '<i class="fa-solid fa-crosshairs"></i> 开始抓取</span></div>'
            : '')
        + (orbDbgTab === 'script'
            ? '<textarea class="ssp-dbg-code" data-ssp-dbgcode="1" spellcheck="false" placeholder="在这里写脚本，直接跑在酒馆页面里。&#10;可以用 await、可以 return 交回结果。&#10;例：return { 宽: innerWidth, dpr: devicePixelRatio, 暗色: matchMedia(\'(prefers-color-scheme: dark)\').matches }"></textarea>'
            : '')
        + '<div class="ssp-dbg-bar">'
        + (orbDbgTab === 'script'
            ? '<span class="ssp-pbtn primary" data-ssp-dbgrun="1"><i class="fa-solid fa-play"></i> 运行</span>'
                + '<span class="ssp-pbtn" data-ssp-dbgsave="1">存为脚本</span>'
                + '<span class="ssp-pbtn" data-ssp-dbgsaved="1">我的脚本</span>'
            : '')
        + '<span class="ssp-pbtn" data-ssp-dbgdiag="screen">屏幕环境</span>'
        + '<span class="ssp-pbtn" data-ssp-dbgdiag="media">媒体查询</span>'
        + '<span class="ssp-pbtn" data-ssp-dbgdiag="css">CSS 支持</span>'
        + '<span class="ssp-pbtn" data-ssp-dbgdiag="state">状态快照</span>'
        + '<span class="ssp-pbtn" data-ssp-dbgdiag="all">全跑一遍</span>'
        + '</div>'
        + '<div class="ssp-dbg-bar ssp-dbgtools">'
        + '<span class="ssp-pbtn" data-ssp-dbgcopy="1" title="复制输出（拿到手机上跑的结果直接发给作者）"><i class="fa-solid fa-copy"></i> 复制输出</span>'
        + '<span class="ssp-pbtn danger" data-ssp-dbgclear="1">清空</span>'
        + '</div>'
        + '<div class="ssp-dbgnote ssp-dbghint">输出（越靠后越新）</div>'
        + '<pre class="ssp-dbg-out" data-ssp-dbgout="1">' + esc(pre || '（输出会显示在这里）') + '</pre>'
        + '</div>';
}

function orbDbgPaint() {
    const el = orbDbgEl();
    if (el) {
        const pre = el.querySelector('[data-ssp-dbgout]');
        if (pre) {
            const txt = orbDbgText() || '（输出会显示在这里）';
            if (pre.textContent !== txt) pre.textContent = txt;
            pre.scrollTop = pre.scrollHeight;
        }
        const ta = el.querySelector('[data-ssp-dbgcode]');
        if (ta && document.activeElement !== ta) ta.value = orbDbgCode;
    }
    const pickBox = document.getElementById('ssp_dbg_pick');
    if (pickBox) {
        const tip = pickBox.querySelector('b');
        if (tip) tip.textContent = orbDbgPick ? '抓取中：点页面上任意元素（先点这里退出）' : '点这里开始抓元素';
    }
}
/** 打开调试 = **切到「调试」页签**（不再另开窗口）。
    外部（抓元素结束、菜单入口）调它都安全：面板没开就先打开面板。 */
function orbDbgOpenWin() {
    orbDbgOpen = true;
    if (!orbOpenNow) { try { openOrb(); } catch (e) { } }
    if (orbTab !== 'debug') { orbTab = 'debug'; orbEditing = null; }
    try { renderOrbPanel(); } catch (e) { }
    return orbDbgEl();
}
/* ⚠️ 调试页签里的所有按钮走**口袋面板上的委托**，不再自己挂监听 ——
   页签只换面板内部 innerHTML，自己挂的监听会随重画一起消失（以前是独立窗口才自己接）。
   处理逻辑在 bindOrb() 的 document 委托里（搜 data-ssp-dbg）。 */
function orbDbgMarkTabs() {
    const el = orbDbgEl();
    if (!el) return;
    el.querySelectorAll('[data-ssp-dbgtab]').forEach(b => {
        const on = b.dataset.sspDbgtab === orbDbgTab;
        if (b.classList) b.classList.toggle('primary', on);
    });
}
function orbDbgFallbackCopy(txt) {
    try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('输出已复制', 'success');
    } catch (e) { toast('复制失败，手动选中输出区复制吧', 'warning'); }
}
function orbDbgDiag(which) {
    orbDbgOpenWin();
    orbDbgTab = 'diag';
    orbDbgMarkTabs();
    const one = k => {
        orbDbgRule('⚙', k === 'screen' ? '诊断 · 屏幕环境' : k === 'media' ? '诊断 · 媒体查询' : k === 'css' ? '诊断 · CSS 支持' : '诊断 · 扩展状态');
        orbDbgSay(k === 'screen' ? orbDbgDiagScreen() : k === 'media' ? orbDbgDiagMedia() : k === 'css' ? orbDbgDiagCss() : orbDbgDiagState());
    };
    if (which === 'all') { ['screen', 'media', 'css', 'state'].forEach(one); }
    else one(which);
    orbDbgSay('');
    orbDbgSay('（点右上「复制输出」把这段发出去就行）');
    orbDbgPaint();
}
function orbDbgSaveScript() {
    const code = orbDbgCode.trim();
    if (!code) { toast('先写点脚本再存', 'warning'); return; }
    orbAskText('给这段脚本起个名字（同名会覆盖）', orbDbgName || '我的脚本').then(nm => {
        const name = String(nm || '').trim();
        if (!name) return;
        const list = orbDbgStore();
        const old = list.filter(x => x && x.name === name)[0];
        if (old) old.code = code; else list.push({ name: name, code: code });
        orbDbgName = name;
        save();
        toast('已存脚本：' + name, 'success');
    });
}
function orbDbgListScripts() {
    const list = orbDbgStore();
    orbDbgDivider('我的脚本（' + list.length + ' 个）');
    if (!list.length) orbDbgSay('  还没有存过脚本。写完点「存为脚本」就存下来了（刷新不丢）。');
    list.forEach((x, i) => orbDbgSay('  [' + (i + 1) + '] ' + x.name));
    if (list.length) {
        orbDbgSay('');
        orbDbgSay('  想看/用它：在下面输入框里敲它的名字再点运行器旁边的「我的脚本」……');
        orbDbgSay('  （简单起见：点下面的按钮直接装载）');
        /* 直接给一排装载按钮：塞进输出区下方 */
        const el = orbDbgEl();
        if (el) {
            let bar = el.querySelector('.ssp-dbg-loadbar');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'ssp-dbg-bar ssp-dbg-loadbar';
                const pre = el.querySelector('[data-ssp-dbgout]');
                if (pre && pre.parentElement) pre.parentElement.insertBefore(bar, pre);
            }
            bar.innerHTML = list.map((x, i) => '<span class="ssp-pbtn" data-ssp-dbgload="' + i + '">' + esc(x.name) + '</span>').join('')
                + list.map((x, i) => '<span class="ssp-pbtn danger" data-ssp-dbgdrop="' + i + '">删' + (i + 1) + '</span>').join('');
        }
    }
    orbDbgPaint();
}
function orbDbgPickStart() {
    orbDbgPick = true;
    orbDbgPendEl = null;
    let box = document.getElementById('ssp_dbg_pick');
    if (!box) {
        box = document.createElement('div');
        box.id = 'ssp_dbg_pick';
        box.innerHTML = '<b>点一下预览 · 再点一下确认（点这条退出）</b>';
        box.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); orbDbgPickOff(); orbDbgOpenWin(); });
        document.body.appendChild(box);
    } else {
        orbDbgPickTip('点一下预览 · 再点一下确认（点这条退出）');
    }
    /* 高亮框（右上角带小标签：tag#id 宽×高） */
    const hl = orbDbgHl();
    if (!document.getElementById('ssp_dbg_hl_lab')) {
        const lab = document.createElement('i');
        lab.id = 'ssp_dbg_hl_lab';
        hl.appendChild(lab);
    }
    document.addEventListener('touchstart', orbDbgPickHandler, true);
    document.addEventListener('touchmove', orbDbgPickMove, true);
    document.addEventListener('mousedown', orbDbgPickHandler, true);
    document.addEventListener('mousemove', orbDbgPickMove, true);
    /* 抓的时候只把调试**内容**压低一点（别挡着页面），抓完自动恢复。
       ⚠️ 以前这里是 el.style.display='none' —— 那时它是独立窗口，藏起来没事；
          现在 #ssp_dbg 是页签内容，藏了等于整页空白（"相关都关不掉"的来源之一）。 */
    const el = orbDbgEl();
    if (el && el.classList) el.classList.add('ssp-picking');
    toast('抓取模式：指着（手机上划到）元素就会画框，点一下预览、再点一下确认', 'info');
}
function orbDbgPickDoneRestore() {
    const el = orbDbgEl();
    if (el && el.classList) el.classList.remove('ssp-picking');
}
function orbDbgClose() {
    orbDbgPickOff();
    /* 现在没有独立窗口可关：退回「番外」页签（= 收起调试） */
    orbDbgOpen = false;
    try { orbDbgPickDoneRestore(); } catch (e) { }
    if (orbTab === 'debug') { orbTab = 'notes'; try { renderOrbPanel(); } catch (e) { } }
}

/* ============================ 常用开关（美化页里的便捷美化） ============================
   用户诉求：一些长期的视觉毛病想靠**插件代码**解决，而不是写进自己的自定义 CSS。
   做法：开关状态存扩展设置（s.beautyTweaks），开启时把对应 CSS 注入到一个
   <style id="ssp_beauty_css"> 里；关掉就把那段样式移除（= 完全还原，不留痕迹）。
   新增一个开关只需要往 ORB_BEAUTY_TWEAKS 里加一条（id / 名字 / 说明 / css / 默认）。
   ---------------------------------------------------------------------------- */
var ORB_BEAUTY_TWEAKS = [
    {
        id: 'topbarBottom',
        name: '顶部展开面板通底',
        desc: '顶部栏拉开的那些面板，高度直接铺到屏幕底部 —— 不然下面会露出一节消息框（用户长期困扰）',
        def: false,
        /* 顶部栏本体只有 35px 高（#top-settings-holder，position:relative），
           面板是挂它下面的绝对定位块。⚠️ e2e 量出来：它原本是 **从顶部 0 开始、高 770**（视口 805，
           底下留 35px），所以光放开 max-height 没用 ✗ —— 必须把 top 也从 0 改成 35、高度按 vh 给，
           它才会铺到屏幕底（35..805）。 */
        css: [
            '#top-settings-holder .drawer-content, #top-settings-holder .drawer > .drawer-content {',
            '  top: 35px !important;',
            '  bottom: 0 !important;',
            '  height: calc(100vh - 35px) !important;',
            '  max-height: none !important;',
            '}',
            '#top-settings-holder .drawer-content > .scrollable, #top-settings-holder .drawer-content > div {',
            '  height: 100% !important;',
            '  max-height: none !important;',
            '  overflow-y: auto !important;',
            '}',
        ].join('\n'),
    },
    {
        id: 'killSeam',
        name: '去掉输入框上面那条线',
        desc: '消息区与底部输入框之间那条 1px 的白线（勘查出来是 #sheld 的 bottom:1px 露了底，以及各层透明露壁纸）',
        def: false,
        css: [
            /* ⚠️ 上一版下手太重了：border-color/box-shadow 一网打尽，把用户自定义 CSS
               给输入框**下部**画的那条线也一起干掉了 ✗（用户立刻反馈）。
               现在收窄成**只掐上边** —— 只把顶部那条白边的颜色改成透明，
               下边框/左右边框/阴影/描边**一律不碰**，用户的设计线原样保留 ✓。
               残留的 1px 缝交给下面的 JS 填缝处理（那是非破坏性的盖色块）。 */
            '#form_sheld, #form_sheld *, #send_form, #send_form *, #nonQRFormItems, #nonQRFormItems * {',
            '  border-top-color: transparent !important;',
            '}',
            /* #sheld 那 1px 露底：改成贴底（不删任何边框） */
            '#sheld { bottom: 0 !important; }',
        ].join('\n'),
    },
];
/* ⚠️ 用户要求（v1.31.41）：把里面这两个开关（顶部展开面板通底 / 去掉输入框上面那条线）**去掉**，
   但**面板和引擎都保留**（以后想加别的便捷开关，直接往上面数组里加一条就行）。
   想恢复这两个：把下面这一行删掉即可 —— 两个开关的定义**原样留在上面，没删**。
   去掉后：s.beautyTweaks 里那两个键没人认领 → 拼出来的 CSS 为空 → 注入的 <style> 会被自动移除，
   也就是你本机上那两条样式**会自己消失**，不需要你手动清。 */
ORB_BEAUTY_TWEAKS = [
    /* ---- 下面是**钩子型**开关（不注入 CSS，直接开/关功能本身）----
       v1.31.58：用户要求「把这些按钮的开关都放在常用开关里面，随开随用」。
       状态**只有一个真源**：s.quickBar（不往 beautyTweaks 里再存一份，免得两边不一致）。 */
    {
        id: 'quickbar', name: '快捷按钮托盘', def: true,
        desc: '浮在发送按钮上方那一小条（回底 / 重新发送）',
        get: () => quickBarSettings().on !== false,
        set: (on) => { quickBarSettings().on = !!on; save(); qbMount(); },
    },
    {
        id: 'qbBottom', name: '托盘 · 回底', def: true,
        desc: '滚到最新一条（自己滚 #chat，不依赖酒馆的"自动滚到底"设置）',
        get: () => quickBarSettings().btns.bottom !== false,
        set: (on) => { quickBarSettings().btns.bottom = !!on; save(); qbMount(); },
    },
    {
        id: 'qbResend', name: '托盘 · 重新发送', def: true,
        desc: '转发酒馆原生的「重新生成」：最后一条是 AI 就重生成、是你的消息就相当于再发一次',
        get: () => quickBarSettings().btns.resend !== false,
        set: (on) => { quickBarSettings().btns.resend = !!on; save(); qbMount(); },
    },
    {
        id: 'qbStartNew', name: '托盘 · 新聊天', def: false,
        desc: '等同于酒馆「选项 → 开始新聊天」（给当前角色开新聊天，现在这份留在存档里）',
        get: () => quickBarSettings().btns.startnew !== false,
        set: (on) => { quickBarSettings().btns.startnew = !!on; save(); qbMount(); },
    },
    {
        id: 'qbDelMes', name: '托盘 · 删除消息', def: false,
        desc: '等同于酒馆「选项 → 删除消息」（打开酒馆自己的删除框，选哪条删哪条）',
        get: () => quickBarSettings().btns.delmes !== false,
        set: (on) => { quickBarSettings().btns.delmes = !!on; save(); qbMount(); },
    },
];
function orbBeautyState() {
    const s = getSettings();
    if (!s.beautyTweaks || typeof s.beautyTweaks !== 'object') s.beautyTweaks = {};
    return s.beautyTweaks;
}
function orbBeautyOn(id) {
    const t = ORB_BEAUTY_TWEAKS.filter(x => x.id === id)[0];
    /* 钩子型：状态在它自己那边（比如 s.quickBar），直接问它 */
    if (t && typeof t.get === 'function') { try { return !!t.get(); } catch (e) { return false; } }
    const st = orbBeautyState();
    if (typeof st[id] === 'boolean') return st[id];
    return !!(t && t.def);
}
/** 把当前开着的开关拼成一段 CSS，注入/更新 <style id="ssp_beauty_css">；全关就整段移除 */
function orbBeautyApply() {
    try {
        /* 钩子型开关：状态变了就让功能本身跟上（托盘就是在这里重挂/撤掉的） */
        ORB_BEAUTY_TWEAKS.filter(t => typeof t.set === 'function').forEach(t => {
            try { t.set(orbBeautyOn(t.id)); } catch (e) { }
        });
        const css = ORB_BEAUTY_TWEAKS.filter(t => orbBeautyOn(t.id) && t.css).map(t => '/* ' + t.name + ' */\n' + t.css).join('\n\n');
        let el = document.getElementById('ssp_beauty_css');
        if (!css) { if (el) el.remove(); try { orbSeamFillOff(); } catch (e) { } return ''; }
        if (!el) {
            el = document.createElement('style');
            el.id = 'ssp_beauty_css';
            (document.head || document.documentElement).appendChild(el);
        }
        el.textContent = css;
        try { orbSeamFillSync(); } catch (e) { }         // 有 JS 参与的那几个开关在这里跟上
        return css;
    } catch (e) { return ''; }
}
/* 通用填缝（「去掉输入框上面那条线」的实现核心）：
   不猜那条线是谁画的 —— 运行时量出「消息区底边 → 输入框顶边」那段空隙的坐标，
   用一块 pointer-events:none 的色块**盖住**它，颜色取输入框自己的底色。
   这样不管那条线是壁纸露出来、伪元素画的、还是 1px 边框，只要它在那段缝里就会被盖掉。
   ⚠️ 每轮都重新量（600ms）：窗口缩放、顶栏抽屉开关、切角色都会改变这段几何。 */
var orbSeamTimer = null;
function orbSeamFillOff() {
    if (orbSeamTimer) { try { clearInterval(orbSeamTimer); } catch (e) { } orbSeamTimer = null; }
    const el = document.getElementById('ssp_seam_fill');
    if (el) el.remove();
}
function orbSeamFillUpdate() {
    try {
        if (!orbBeautyOn('killSeam')) { orbSeamFillOff(); return false; }
        const chat = document.getElementById('chat');
        const form = document.getElementById('send_form');
        if (!chat || !form) return false;
        const cr = chat.getBoundingClientRect(), fr = form.getBoundingClientRect();
        const gap = Math.round(fr.top - cr.bottom);
        let el = document.getElementById('ssp_seam_fill');
        if (gap <= 0) { if (el) el.remove(); return false; }      // 没缝就不用盖
        const cs = getComputedStyle(form);
        const bg = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') ? cs.backgroundColor : 'rgba(26,28,32,.95)';
        if (!el) {
            el = document.createElement('div');
            el.id = 'ssp_seam_fill';
            (document.body || document.documentElement).appendChild(el);
        }
        el.style.left = Math.round(cr.left) + 'px';
        el.style.width = Math.round(cr.width) + 'px';
        el.style.top = Math.round(cr.bottom) + 'px';
        el.style.height = gap + 'px';
        el.style.background = bg;
        return true;
    } catch (e) { return false; }
}
/** 开关变化时调一次：开着就起轮询、关掉就彻底清掉（完全还原） */
function orbSeamFillSync() {
    if (!orbBeautyOn('killSeam')) { orbSeamFillOff(); return false; }
    orbSeamFillUpdate();
    if (!orbSeamTimer) orbSeamTimer = setInterval(orbSeamFillUpdate, 600);
    return true;
}

function orbBeautySet(id, on) {
    const t = ORB_BEAUTY_TWEAKS.filter(x => x.id === id)[0];
    if (t && typeof t.set === 'function') {           // 钩子型：交给它自己存
        try { t.set(!!on); } catch (e) { }
        save();
        orbBeautyApply();
        return !!on;
    }
    const st = orbBeautyState();
    st[id] = !!on;
    save();
    orbBeautyApply();
    return !!on;
}
function orbBeautyReset() {
    getSettings().beautyTweaks = {};
    /* 钩子型开关也回到各自表里的默认值（否则"全部恢复默认"只影响 CSS 那几条） */
    ORB_BEAUTY_TWEAKS.filter(t => typeof t.set === 'function').forEach(t => {
        try { t.set(t.def !== false); } catch (e) { }
    });
    save();
    orbBeautyApply();
    toast('常用开关已全部恢复默认', 'success');
}
/* 页面加载时自动把开着的开关注入进去。
   ⚠️ 不去找 init 钩子：模块执行时设置可能还没读回来，所以延时几趟、每趟都重来一次（幂等，安全）。
   刷新页面后开关依然是生效状态 —— 这是"存扩展设置、刷新保持"那一条的落点。 */
[800, 1800, 3500].forEach(ms => {
    try {
        setTimeout(() => {
            try { orbBeautyApply(); } catch (e) { }
            try { sspSkinApply(); } catch (e) { }      // v1.31.77 面板配色自锁（同样要等设置读回来）
        }, ms);
    } catch (e) { }
});
/** 面板里那一块（挂在美化页 —— 用户要求：就在「改当前美化 / 新建美化 / 导出当前美化」**这一排按钮下面**，
    并且用**展开栏**的格式（点标题展开/收起），而不是扔在页面最底下没人翻得到） */
var orbBeautyOpen = false;      // 展开栏是否展开（默认收起，标题条就在按钮下面，一眼能看到）
function orbBeautyHTML() {
    const rows = ORB_BEAUTY_TWEAKS.map(t => {
        const on = orbBeautyOn(t.id);
        return '<div class="ssp-bt-row' + (on ? ' on' : '') + '">'
            + '<span class="ssp-bt-sw" data-orb-btweak="' + t.id + '" role="button" tabindex="0"'
            + ' title="点一下' + (on ? '关掉' : '开启') + '"><i class="fa-solid ' + (on ? 'fa-toggle-on' : 'fa-toggle-off') + '"></i></span>'
            + '<span class="ssp-bt-main" data-orb-btweak="' + t.id + '">'
            + '<b>' + esc(t.name) + '</b><small>' + esc(t.desc) + '</small></span>'
            + '</div>';
    }).join('');
    const anyOn = ORB_BEAUTY_TWEAKS.filter(t => orbBeautyOn(t.id)).length;
    const head = '<div class="ssp-bt-head ssp-bt-toggle" data-orb-btopen="1" role="button" tabindex="0"'
        + ' title="' + (orbBeautyOpen ? '收起' : '展开') + '常用开关">'
        + '<i class="fa-solid ' + (orbBeautyOpen ? 'fa-caret-down' : 'fa-caret-right') + '"></i>'
        + '<b>常用开关</b>'
        + '<small>' + (anyOn ? ('已开 ' + anyOn + ' 个') : '一键美化小毛病（点标题展开）') + '</small>'
        + '<span class="ssp-bt-arrow"><i class="fa-solid fa-sliders"></i></span>'
        + '</div>';
    if (!orbBeautyOpen) return '<div class="ssp-bt collapsed">' + head + '</div>' + sspSkinHTML() + orbContrastHTML();
    return '<div class="ssp-bt open">' + head
        + '<div class="ssp-bt-note">CSS 类的开关由扩展注入样式实现（**不写进你的自定义 CSS**）；'
        + '带「托盘」字样的那几个是直接开关功能本身。关掉即完全撤销。</div>'
        + rows
        + '<div class="ssp-bt-foot">'
        + '<span class="ssp-pbtn" data-orb-btreset="1">' + (anyOn ? '全部关掉（恢复默认）' : '已全部关闭') + '</span>'
        + '<span class="ssp-pbtn" data-orb-btreload="1" title="重新注入一次（排错用）">重新应用</span>'
        + '</div></div>' + sspSkinHTML() + orbContrastHTML();
}

/* ============================ 面板配色自锁（v1.31.77） ============================
   为什么要有：有些美化会把"文字色"和"底色"调成同一个颜色，用户连"去哪改"都看不见，
   等于把入口本身弄瞎。实测（用户的「仿p5」，v1.31.77 那次）有两种病，性质不一样：

     ① 变量撞车：写卡/选卡页（影子 DOM）里的淡字是 --ch-ink 和 --ch-bg 按比例混出来的，
        而这两个是从 --SmartThemeBodyColor / --SmartThemeBlurTintColor 推出来的。
        仿p5 是 #0B0B0D + #16161A → 混出来 1.06 : 1，"底色上写底色"，整页等于没字。
     ② 全局 !important：`body * { color: … !important }` 这种粗暴美化，跟变量一点关系
        都没有，光改变量救不了。

   办法（两层）：
     a) 只在**我们自己的容器**上把这几个 --SmartTheme* 就地重声明成一套固定色板。
        自定义属性的层叠是"选择器更具体的赢"，我们写 id + !important，美化在 :root 里
        写 !important 也压不掉。→ 治①
     b) 再补一层兜底：`#我们的容器 :is(几个关键 class) { color: … !important }`。
        id 选择器比 `body *` 具体，两个都 !important 时我们赢。→ 治②
        代价：锁色时面板会变"单色"，这是故意的 —— 救命模式先保证看得清。
    作用域到我们的容器为止，酒馆原生界面 / 角色卡列表一律不碰。

   三档（存 s.panelSkin）：
     auto   先量一遍"如果按美化颜色来，我们面板上最差的那处对比度是多少"，
            < 3 才锁深色（默认档）
     follow 不注入，完全跟美化（老行为）
     dark   固定深色板
   ⚠️ 没做「固定浅色」：面板自己的背景是写死的深色（不是变量），只把字换成深色
      等于深字压深底（实测 1.12 : 1）。要做浅色得连面板背景一起换，那是另一件事。
   ========================================================================== */
const SSP_SKIN_SEL = '#ssp_panel_root, #ssp_orb, #ssp_orb_root, #ssp_quickbar, #ssp_mount';
const SSP_SKIN_MODES = [['auto', '自动'], ['follow', '跟随美化'], ['dark', '固定深色']];
const SSP_SKIN_VARS = {
    dark: {
        '--SmartThemeBodyColor': '#e9e9f0',
        '--SmartThemeBlurTintColor': '#16161d',
        '--SmartThemeBorderColor': 'rgba(255, 255, 255, .16)',
        '--SmartThemeEmColor': '#8fb6ff',
        '--SmartThemeQuoteColor': '#cfd3dc',
    },
};
let sspSkinNow = '';            // 现在实际生效的：follow / dark
let sspSkinProbeLast = null;    // {worst, at: {名字, 对比度}}

function sspSkinMode() {
    const s = getSettings();
    const m = String(s.panelSkin || 'auto');
    return ['auto', 'follow', 'dark'].indexOf(m) >= 0 ? m : 'auto';
}
function sspSkinSet(mode) {
    const s = getSettings();
    s.panelSkin = ['auto', 'follow', 'dark'].indexOf(String(mode)) >= 0 ? String(mode) : 'auto';
    save();
    sspSkinProbeLast = null;
    sspSkinApply(true);
}
/** 解析 rgb()/rgba()/#hex/transparent —— 拿不到就返回 null（调用方要能忍） */
function sspParseColor(c) {
    const s = String(c || '').trim().toLowerCase();
    if (!s) return null;
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    let m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (m) {
        const p = m[1].split(/[,/\s]+/).filter(x => x !== '').map(Number);
        if (p.length < 3 || p.some(isNaN)) return null;
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? Math.max(0, Math.min(1, p[3])) : 1 };
    }
    m = /^#([0-9a-f]{3,8})$/.exec(s);
    if (m) {
        let h = m[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + 'ff';
        if (h.length === 6) h += 'ff';
        if (h.length !== 8) return null;
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
    }
    /* color-mix() 的**算完结果**在 Chrome 里是 `color(srgb 0.06 0.06 0.08)` 这种写法
       （我们的 --ch-ink-2/3 就是 color-mix 混出来的，不认它就会漏掉整个写卡页） */
    m = /^color\(\s*srgb\s+([^)]+)\)$/.exec(s);
    if (m) {
        const p = m[1].split(/[/\s]+/).filter(x => x !== '').map(Number);
        if (p.length >= 3 && !p.slice(0, 3).some(isNaN)) {
            return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 && !isNaN(p[3]) ? Math.max(0, Math.min(1, p[3])) : 1 };
        }
    }
    return null;
}
/** fg 盖在 bg 上（都带 alpha） */
function sspMixColor(fg, bg) {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a <= 0.0001) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (x, y) => (x * fg.a + y * bg.a * (1 - fg.a)) / a;
    return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}
/** WCAG 相对亮度 */
function sspLum(c) {
    const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
/** WCAG 对比度（1 ~ 21） */
function sspContrast(a, b) {
    if (!a || !b) return null;
    const la = sspLum(a), lb = sspLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** 往上找"实际铺在下面的颜色"：最近的不透明背景，边找边合成
    ⚠️ 顺手记一下"这段路上有没有背景图"：只看到"铺出底色"那一层为止，
       不能一路往上翻 8 层 —— 美化的 body/#chat 通常都挂背景图，那样每行都带 ※，等于没信息。 */
function sspEffBgEx(el) {
    let acc = null, node = el, guard = 0, 有图 = false;
    while (node && node.nodeType === 1 && guard++ < 40) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') 有图 = true;
        const c = sspParseColor(cs.backgroundColor);
        if (c && c.a > 0) { acc = acc ? sspMixColor(acc, c) : c; if (acc.a >= 0.995) break; }
        node = node.parentElement;
    }
    const base = { r: 255, g: 255, b: 255, a: 1 };   // 最后还有透明就压在白底上算
    return { bg: acc ? sspMixColor(acc, base) : { r: 12, g: 12, b: 14, a: 1 }, 有图 };
}
function sspEffBg(el) { return sspEffBgEx(el).bg; }
/** 量面板上几处自己的文字：如果按"美化原色"来，最差的那处对比度是多少
    ⚠️ 只量**主文字**（标题 / 页签 / 按钮）。别量 .ssp-orb-title small 那种次级文字：
       它本来就是淡的（opacity .5 或 --ch-ink-3 混色），跟着深色美化时天然只有 1.0x，
       量它会让"自动档"在健康主题上也乱锁 —— 第一版就是这么误锁的。 */
const SSP_SKIN_PROBE = [
    ['口袋标题', '#ssp_orb_panel .ssp-orb-title b'],
    ['口袋页签', '#ssp_orb_panel .ssp-orb-tab'],
    ['口袋按钮', '#ssp_orb_panel .ssp-pbtn'],
    ['面板标题', '#ssp_panel .ssp-p-title b'],
    ['面板按钮', '#ssp_panel .ssp-pbtn'],
    ['悬浮球', '#ssp_orb i'],
];
function sspSkinProbeRead() {
    const list = [];
    /* ⓪ 先量"变量自洽性"：写卡 / 选卡两页（影子 DOM）里的淡字是 --ch-ink 和 --ch-bg
          按比例混出来的。美化只要把 BodyColor 和 BlurTintColor 调成同一个色，
          混出来就是"底色上写底色"，整页等于没字。
          实测：用户的「仿p5」是 BodyColor #0B0B0D + BlurTint #16161A → 1.06 : 1，
          写卡页那句提示真的看不见。影子里的元素 document.querySelector 抓不到，
          所以这里直接量变量（在面板根上量，正好能拿到 --ch-*）。 */
    try {
        const host = document.getElementById('ssp_orb_panel') || document.body;
        const cs = getComputedStyle(host);
        const ink = sspParseColor(cs.getPropertyValue('--ch-ink').trim());
        const bg = sspParseColor(cs.getPropertyValue('--ch-bg').trim());
        const cr = sspContrast(ink, bg);
        if (cr !== null) list.push({ 名字: '写卡页淡字', 对比度: cr });
    } catch (e) { }
    for (const [name, sel] of SSP_SKIN_PROBE) {
        let el = null;
        try { el = document.querySelector(sel); } catch (e) { el = null; }
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.opacity !== '' && Number(cs.opacity) < 0.9) continue;   // 本来就淡的，别算
        const fg = sspParseColor(cs.color);
        if (!fg) continue;
        const bg = sspEffBg(el);
        /* v1.31.80：字号也一起量 —— 美化把字号压到 6px，颜色再对也看不见 */
        const fs = parseFloat(cs.fontSize) || 0;
        const one = { 名字: name, 对比度: null, 字号: fs };
        if (fg.a < 1) {
            /* 文字半透明：先跟"它下面的颜色"合成，再比 */
            const flat = sspMixColor(fg, bg);
            one.对比度 = sspContrast(flat, bg);
        } else {
            one.对比度 = sspContrast(fg, bg);
        }
        if (one.对比度 === null && !(fs > 0 && fs < SSP_CT_MIN_PX)) continue;
        list.push(one);
    }
    if (!list.length) return null;
    /* 排序：先按"哪种更严重"（字号太小优先报），再按对比度 */
    list.sort((a, b) => (a.对比度 === null ? 99 : a.对比度) - (b.对比度 === null ? 99 : b.对比度));
    const 小字 = list.filter(x => x.字号 > 0 && x.字号 < SSP_CT_MIN_PX);
    if (小字.length) {
        const w = 小字.slice().sort((a, b) => a.字号 - b.字号)[0];
        return { worst: { 名字: w.名字, 对比度: w.对比度 === null ? 0 : w.对比度, 字号: w.字号, 太小: true }, list, 最小字号: w.字号 };
    }
    return { worst: list[0], list, 最小字号: list.reduce((m, x) => Math.min(m || 99, x.字号 || 99), 99) };
}
/** 量的时候先把我们自己的锁摘掉，量完原地装回去（同一帧内，不会闪） */
function sspSkinProbe(force) {
    if (!force && sspSkinProbeLast) return sspSkinProbeLast;
    const st = document.getElementById('ssp_panel_skin');
    const keep = st ? st.textContent : null;
    let out = null;
    try {
        if (st) st.textContent = '';
        out = sspSkinProbeRead();
    } catch (e) { out = null; }
    finally { if (st) st.textContent = keep || ''; }
    if (out) sspSkinProbeLast = out;
    return out;
}
function sspSkinDecide() {
    const mode = sspSkinMode();
    const probe = (mode === 'auto') ? sspSkinProbe() : null;
    let skin = 'follow', why = '跟美化', 字体过小 = false;
    if (mode === 'dark') { skin = 'dark'; why = '你选的固定深色'; }
    else if (mode === 'auto') {
        const worse = probe && probe.worst;
        if (worse && worse.太小) {
            skin = 'dark'; 字体过小 = true;
            why = '自动：' + worse.名字 + '只有 ' + worse.字号 + 'px，太小了';
        } else if (worse && worse.对比度 < 3) {
            skin = 'dark';
            why = '自动：' + worse.名字 + '只有 ' + worse.对比度.toFixed(2) + ' : 1，看不见';
        } else {
            why = worse ? ('自动：最差也有 ' + worse.对比度.toFixed(2) + ' : 1，能看清') : '自动：没有可量的地方';
        }
    }
    /* 手选深色时也要知道"字号是不是被压小了"，好决定要不要上字号下限 */
    if (skin === 'dark' && probe && probe.最小字号 && probe.最小字号 < SSP_CT_MIN_PX) 字体过小 = true;
    return { mode, skin, why, probe, 字体过小 };
}
/** 锁色板时要一起"护住"的文字（这些是我们面板上必须看得见的东西）。
    ⚠️ 只写 var 是不够的：有些美化是 `body *{color:…!important}` 这种**全局 !important**，
       跟变量一点关系都没有。所以要再补一层带 !important + id 选择器的兜底
       （id 选择器比 body * 更具体，两个都 !important 时我们赢）。
       代价：锁色时面板会变成"单色"，这是故意的 —— 救命模式先保证能看清。 */
const SSP_SKIN_INK = [
    '.ssp-orb-title b', '.ssp-orb-tab', '.ssp-pbtn', '.ssp-p-title', '.ssp-tv-title', '.ssp-tv-ghead',
    '.ssp-bt-main b', '.ssp-bt-toggle b', '.ssp-skin-head b', '.ssp-skin-seg .ssp-pbtn', '.ssp-inp', '.ssp-orb-pfilter',
];
const SSP_SKIN_MUTED = [
    '.ssp-orb-title small', '.ssp-bt-main small', '.ssp-bt-toggle small', '.ssp-skin-head small',
    '.ssp-skin-now', '.ssp-bt-note', '.ssp-orb-empty', '.ssp-tv-k', '.ssp-tv-num',
];

/** 把固定色板注入/撤掉（返回这次的决定，给 UI 和测试用） */
function sspSkinApply(force) {
    const d = sspSkinDecide();
    sspSkinNow = d.skin;
    let st = document.getElementById('ssp_panel_skin');
    if (!st) {
        st = document.createElement('style');
        st.id = 'ssp_panel_skin';
        st.setAttribute('type', 'text/css');
        document.head.appendChild(st);
    }
    let txt = '';
    if (d.skin !== 'follow') {
        const v = SSP_SKIN_VARS[d.skin];
        const ink = v['--SmartThemeBodyColor'];
        const muted = d.skin === 'dark' ? '#a7a9b6' : '#585c68';
        const decl = Object.keys(v).map(k => k + ': ' + v[k] + ' !important;').join(' ');
        /* ① 把这几个变量就地重声明（我们容器里的 var(--SmartTheme*) 全跟着变）
           ② 给容器自己补一个兜底 color：只影响"本来会去继承 body 颜色"的元素，
              我们自己的 class 规则照样赢（继承来的值永远输给直接声明）
           ③ 兜底层：防全局 !important 的粗暴美化
           ⚠️ 根选择器是逗号列表，**必须**包进 :is() —— 否则 `A, B .x` 里只有 B 才是祖先。
              第一版就踩了：兜底层只对 #ssp_mount 生效，测试里 1.03 原样不动。 */
        const ROOT = ':is(' + SSP_SKIN_SEL + ')';
        txt = SSP_SKIN_SEL + ' { ' + decl + ' color: ' + ink + ' !important; }'
            + ROOT + ' :is(' + SSP_SKIN_INK.join(', ') + ') { color: ' + ink + ' !important; }'
            + ROOT + ' :is(' + SSP_SKIN_MUTED.join(', ') + ') { color: ' + muted + ' !important; }';
        /* ④ v1.31.80：字号被压扁（< 9px）时，给主文字一个 12px 的地板。
              只在"真的被压扁"时才加 —— 平时不改我们的排版（标题本来是 12.5~14.5px，
              无脑加地板会把它们全压成一样大）。 */
        const 最小 = (d.probe && d.probe.最小字号) || 99;
        if (最小 < 9) {
            txt += ROOT + ' :is(' + SSP_SKIN_INK.join(', ') + ') { font-size: 12px !important; }';
        }
    }
    if (st.textContent !== txt) st.textContent = txt;
    return d;
}
function sspSkinHTML() {
    const d = sspSkinDecide();
    const mode = d.mode;
    const seg = SSP_SKIN_MODES.map(([k, label]) => '<span class="ssp-pbtn' + (k === mode ? ' on' : '')
        + '" data-orb-skin="' + k + '" title="' + (k === 'auto' ? '对比度不够时自动锁一套固定色' : label) + '">' + label + '</span>').join('');
    const worst = d.probe && d.probe.worst;
    const now = d.skin === 'follow' ? '现在：跟随美化'
        : ('现在：已锁' + (d.skin === 'dark' ? '深色' : '浅色'));
    return '<div class="ssp-skin">'
        + '<div class="ssp-skin-head"><b>面板配色</b>'
        + '<small>有些美化会把文字调成跟背景一个颜色，连面板都看不见 —— 这一档给面板自己留一套颜色</small></div>'
        + '<div class="ssp-skin-seg">' + seg
        + '<span class="ssp-sp"></span>'
        + '<span class="ssp-pbtn" data-orb-skinretest="1" title="重新量一次对比度">重测</span></div>'
        + '<div class="ssp-skin-now' + (worst && worst.对比度 < 3 ? ' bad' : '') + '">' + esc(now) + '　·　' + esc(d.why)
        + (worst ? '（最差一处：' + esc(worst.名字) + '）' : '') + '</div>'
        + '</div>';
}

/* ============================ 对比度体检（v1.31.78） ============================
   上面那版（v1.31.77）只是"护住我们自己的面板"。可美化真正闹出来的事是**酒馆自己的字**也看不见：
   正文、角色名、输入框、侧栏标题 —— 这些不归我们管，只能"体检 + 找出元凶 + 帮你改回去"。

   三件事：
     ① 体检：在几个关键位置真量 `color` 和"往上第一个不透明背景"，算 WCAG 对比度（< 3 标红）。
        不靠变量名猜 —— 变量名骗人，算出来的颜色不骗人。
     ② 找元凶：把当前美化的 CSS 解析成规则表，挑出"选择器能命中这个元素、且 color /
        background-color 里用了 var(--x)"的规则 → 候选变量；再用哨兵色实测确认一次。
        静态匹配，不闪屏、不改页面。
     ③ 一键修：保色相、只推亮度，算到 ≥ 4.5:1，写进**覆盖层**（不动主题文件），当场预览；
        满意再点「写回主题」（人手点，绝不自动写）。
   ========================================================================== */
const SSP_CT_MIN_PX = 11;   // v1.31.80：正文小到这个字号以下就算"看不清"（酒馆默认是 15px 上下）
const SSP_CT_POINTS = [
    ['聊天正文', '#chat .mes_text'],
    ['角色名字', '#chat .ch_name'],
    ['输入框文字', '#send_textarea'],
    ['楼层/时间', '#chat .mes_block .timestamp'],
    ['右侧栏标题', '#right-nav-panel .inline-drawer-header'],
    ['顶栏图标', '#top-settings-holder .drawer-icon'],
    ['我们面板标题', '#ssp_orb_panel .ssp-orb-title b'],
    ['我们面板按钮', '#ssp_orb_panel .ssp-pbtn'],
];
var orbCtRows = null;        // 最近一次体检结果
var orbCtEls = [];           // 对应的真实元素（不序列化，只在本页用）
var orbCtOpen = false;       // 展开栏
var sspCssRuleCache = { css: null, rules: [] };

/** 把 CSS 里的一段声明拆开：**不能**直接 split(';') —— 美化的 url(data:image/png;base64,…) 里就有分号 */
function sspSplitDecls(body) {
    const out = [];
    let buf = '', depth = 0, quote = '';
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (quote) { buf += ch; if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ';' && depth === 0) { out.push(buf); buf = ''; continue; }
        buf += ch;
    }
    out.push(buf);
    return out;
}
/** 把一个 CSS 文本解析成 [{sel, decls:[{prop,val}]}]（@media/@supports 钻进去，@keyframes 跳过）
    ⚠️ 必须"永不抛错"：美化的 CSS 可能有 @import、嵌套注释、坏括号 —— 解析失败就当没有规则，
       宁可少报，也不能把面板搞崩。 */
function sspCssRules(css) {
    const text = String(css || '');
    if (sspCssRuleCache.css === text) return sspCssRuleCache.rules;
    const rules = [];
    try {
        const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
        const findClose = (from) => {
            let depth = 1, j = from;
            while (j < src.length && depth > 0) {
                if (src[j] === '{') depth++;
                else if (src[j] === '}') depth--;
                j++;
            }
            return j - 1;
        };
        const walk = (from, to) => {
            let k = from, guard = 0;
            while (k < to && guard++ < 20000) {
                const lb = src.indexOf('{', k);
                if (lb < 0 || lb >= to) break;
                const sel = src.slice(k, lb).trim();
                const rb = findClose(lb + 1);
                if (rb < 0 || rb > to) break;
                const body = src.slice(lb + 1, rb);
                if (/^@(media|supports|layer|document|container)/i.test(sel)) walk(lb + 1, rb);
                else if (/^@/.test(sel)) { /* @keyframes / @font-face 之类：跳过 */ }
                else if (sel) {
                    const decls = [];
                    sspSplitDecls(body).forEach(d => {
                        const c = d.indexOf(':');
                        if (c < 0) return;
                        const prop = d.slice(0, c).trim().toLowerCase();
                        const val = d.slice(c + 1).trim();
                        if (prop && val) decls.push({ prop, val });
                    });
                    if (decls.length) rules.push({ sel, decls });
                }
                k = rb + 1;
            }
        };
        walk(0, src.length);
    } catch (e) { /* 解析失败：返回空规则表 */ }
    sspCssRuleCache = { css: text, rules };
    return rules;
}
/** 极简特异性打分（够用来排序候选） */
function sspSpec(sel) {
    const ids = (sel.match(/#[\w-]+/g) || []).length;
    const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
    const tag = (sel.replace(/[#.\][:][^\s>+~]*/g, '').match(/[a-z]+/gi) || []).length;
    return ids * 10000 + cls * 100 + tag;
}
/** 哪些美化规则在给这个元素的 color / background-color / font-size 供值？返回 [{k, prop, sel}]
    props 可以传：['color','background-color','background','font-size']（默认只查颜色） */
const SSP_BLAME_PROPS = ['color', 'background-color', 'background'];
function sspBlameVar(el, props) {
    if (!el || !el.matches) return [];
    const wantProps = Array.isArray(props) && props.length ? props : SSP_BLAME_PROPS;
    const rules = sspCssRules(orbThemeCss());
    const hits = [];
    for (const rule of rules) {
        const props = rule.decls.filter(d => wantProps.indexOf(d.prop) >= 0);
        if (!props.length) continue;
        const vars = [];
        props.forEach(d => {
            const re = /var\(\s*--([\w-]+)/g;
            let m;
            while ((m = re.exec(d.val))) vars.push({ k: '--' + m[1], prop: d.prop });
        });
        if (!vars.length) continue;
        const parts = rule.sel.split(',').map(s => s.trim()).filter(Boolean);
        let matched = '';
        for (const part of parts) {
            if (/::|:before|:after/i.test(part)) continue;      // 伪元素不参与
            let ok = false;
            try { ok = el.matches(part); } catch (e) { ok = false; }
            if (!ok) {
                const bare = part.replace(/:(hover|focus|focus-visible|active|visited|checked|disabled)\b/gi, '');
                try { ok = bare && bare !== part && el.matches(bare); } catch (e) { ok = false; }
            }
            if (ok) { matched = part; break; }
        }
        if (!matched) continue;
        vars.forEach(v => hits.push({ k: v.k, prop: v.prop, sel: matched, spec: sspSpec(matched) }));
    }
    /* 去重（同名变量只留最具体的那条），按特异性降序 */
    const seen = new Set();
    const out = [];
    hits.sort((a, b) => b.spec - a.spec).forEach(h => {
        const key = h.k + '|' + h.prop;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(h);
    });
    return out;
}
/** 颜色 → HSL（0~360, 0~1, 0~1） */
function sspToHsl(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0.0001) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const l = (max + min) / 2;
    const s = d < 0.0001 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { h, s, l };
}
function sspFromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return { r: Math.round((rgb[0] + m) * 255), g: Math.round((rgb[1] + m) * 255), b: Math.round((rgb[2] + m) * 255), a: 1 };
}
function sspRgbToHex(c) {
    const two = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + two(c.r) + two(c.g) + two(c.b);
}
/** 保色相、只推亮度，算到对比度 ≥ target（够不到就返回能到的最好那个） */
function sspFixColorToContrast(fg, bg, target) {
    const hsl = sspToHsl(fg);
    const need = Number(target) || 4.5;
    const bgLum = sspLum(bg);
    const wantLight = bgLum < 0.4;          // 深底 → 把字调亮；浅底 → 调暗
    const base = sspContrast(fg, bg) || 1;
    if (base >= need) return { color: sspRgbToHex(fg), cr: base, 改了吗: false };
    const c0 = { color: sspRgbToHex(fg), cr: base, 改了吗: true };
    const tryL = (l) => sspFromHsl(hsl.h, hsl.s, Math.max(0, Math.min(1, l)));
    let best = c0;
    /* 先粗扫，再在最优附近细扫 —— 比二分稳（对比度对亮度不是单调的） */
    for (let l = 0; l <= 1.0001; l += 0.02) {
        const cand = tryL(l);
        const cr = sspContrast(cand, bg) || 1;
        if (cr > best.cr) best = { color: sspRgbToHex(cand), cr, 改了吗: true };
        if (cr >= need && (wantLight ? l > hsl.l : l < hsl.l)) {
            /* 已经够亮了/够暗了，取"离原色最近且达标"的方向 */
            let fine = best;
            for (let d = -0.02; d <= 0.0201; d += 0.002) {
                const cc = tryL(l + d);
                const c2 = sspContrast(cc, bg) || 1;
                if (c2 >= need && c2 < fine.cr + 0.001) fine = { color: sspRgbToHex(cc), cr: c2, 改了吗: true };
            }
            return fine.cr >= need ? fine : best;
        }
    }
    return best;
}
/** 跑一遍体检：返回 [{名字, 选择器, 前景, 背景, 对比度, 有图}]，元素塞进 orbCtEls */
function sspContrastRun() {
    const rows = [];
    orbCtEls = [];
    SSP_CT_POINTS.forEach(([name, sel]) => {
        let el = null;
        try { el = document.querySelector(sel); } catch (e) { el = null; }
        if (!el) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (Number(cs.opacity) < 0.35) return;          // 本来就淡的（时间戳之类）不算病
        const fgRaw = sspParseColor(cs.color);
        if (!fgRaw) return;
        const bgInfo = sspEffBgEx(el);
        const bg = bgInfo.bg;
        const fg = fgRaw.a < 1 ? sspMixColor(fgRaw, bg) : fgRaw;
        const cr = sspContrast(fg, bg);
        if (cr === null) return;
        orbCtEls.push(el);
        /* v1.31.80：字号也算"看得清"的一部分 —— 8px 的字再怎么高对比也看不清。
           行高一起量（< 1.05 倍字号就是挤在一起，读起来费劲）。 */
        const fs = parseFloat(cs.fontSize) || 0;
        const lhRaw = String(cs.lineHeight || '');
        const lh = /px$/.test(lhRaw) ? parseFloat(lhRaw) : (parseFloat(lhRaw) || 0) * fs;
        rows.push({ 名字: name, 选择器: sel, 前景: sspRgbToHex(fg), 背景: sspRgbToHex(bg),
                    对比度: +cr.toFixed(2), 有图: bgInfo.有图,
                    字号: +fs.toFixed(1), 行高: lh ? +lh.toFixed(1) : 0,
                    太小: fs > 0 && fs < SSP_CT_MIN_PX,
                    太挤: fs > 0 && lh > 0 && lh < fs * 1.05 });
    });
    orbCtRows = rows;
    return rows;
}
/** 一处算不算"看不清"：对比度 < 3，或者字号小于 SSP_CT_MIN_PX */
function sspCtBad(row) { return !!row && (row.对比度 < 3 || !!row.太小); }
/** 用哨兵色实测确认候选：把这个变量临时设成 #123456，看元素颜色变不变（同一帧内还原，不闪） */
function sspBlameConfirm(el, hits) {
    if (!el || !hits || !hits.length) return [];
    const sent = '#123456';
    let st = document.getElementById('ssp_ct_sentinel');
    if (!st) {
        st = document.createElement('style');
        st.id = 'ssp_ct_sentinel';
        st.setAttribute('type', 'text/css');
        document.head.appendChild(st);
    }
    const out = [];
    for (const h of hits.slice(0, 4)) {
        const prop = h.prop === 'color' ? 'color' : 'backgroundColor';
        let before = '', now = '';
        try { before = getComputedStyle(el)[prop]; } catch (e) { }
        try {
            st.textContent = ':root, html, body { ' + h.k + ': ' + sent + ' !important; }';
            now = getComputedStyle(el)[prop];
        } catch (e) { now = ''; }
        st.textContent = '';
        if (now && now !== before) out.push(Object.assign({}, h, { 确认: /18\s*,\s*52\s*,\s*86/.test(now) }));
    }
    const yes = out.filter(x => x.确认);
    return yes.length ? yes : out;
}
/** 给看不清的那几处找元凶（只找"看不清"的，省得白跑）
    v1.31.80：字号太小也算"看不清"，所以一并找 font-size 的元凶（分开存，修的时候各走各的） */
function sspContrastBlame() {
    const rows = orbCtRows || [];
    let found = 0;
    rows.forEach((row, i) => {
        if (!sspCtBad(row)) { row.元凶 = row.元凶 || []; row.字号元凶 = row.字号元凶 || []; return; }
        const el = orbCtEls[i];
        const colorHits = sspBlameVar(el, ['color']).filter(h => h.prop === 'color');
        const ok = sspBlameConfirm(el, colorHits);
        row.元凶 = ok;
        if (ok.length) found++;
        /* 字号：没有"哨兵色"这种捷径，直接看哪条规则用 var() 给了 font-size */
        if (row.太小) {
            const fsHits = sspBlameVar(el, ['font-size']).filter(h => h.prop === 'font-size');
            row.字号元凶 = fsHits;
            if (fsHits.length) found++;
        } else {
            row.字号元凶 = [];
        }
    });
    return found;
}
/** 写一条"兜底样式"（只在找不到元凶、或元凶是背景色时才用；这是跟美化打架的路）
    ⚠️ 光往样式表里写 `选择器 {color:…!important}` 常常压不住：美化的规则往往写成
       `html body #chat .mes_text{…!important}`，特异性比我们高（实测写进去还是原色）。
       所以写完**量一次**，没生效就退到行内 !important（行内最高，且能撤销）。 */
function sspCtFallback(sel, decl, el) {
    let st = document.getElementById('ssp_contrast_fix');
    if (!st) {
        st = document.createElement('style');
        st.id = 'ssp_contrast_fix';
        st.setAttribute('type', 'text/css');
        document.head.appendChild(st);
    }
    /* v1.31.80：第二个参数既能是颜色字符串（老调用），也能是 {color, fontSize} */
    const d = (decl && typeof decl === 'object') ? decl : { color: decl };
    const CSS_PROP = { color: 'color', fontSize: 'font-size', lineHeight: 'line-height' };
    const body = Object.keys(d).filter(k => d[k]).map(k => (CSS_PROP[k] || k) + ': ' + d[k] + ' !important;').join(' ');
    const rule = String(sel) + ' { ' + body + ' }';
    if (st.textContent.indexOf(rule) < 0) st.textContent = (st.textContent || '') + rule + '\n';
    let 用了行内 = false;
    if (el && el.style) {
        /* 写完量一次：样式表没压住就退到行内 !important（行内最高，且能撤销） */
        const checks = [];
        if (d.color) checks.push(['color', sspParseColor(d.color), () => getComputedStyle(el).color]);
        if (d.fontSize) checks.push(['fontSize', parseFloat(d.fontSize), () => parseFloat(getComputedStyle(el).fontSize)]);
        for (const [prop, want, got] of checks) {
            let ok = false;
            try {
                const now = got();
                ok = (typeof want === 'number') ? (Math.abs(now - want) < 1.5) : (function () {
                    const n = sspParseColor(now);
                    return want && n && Math.abs(want.r - n.r) < 2 && Math.abs(want.g - n.g) < 2 && Math.abs(want.b - n.b) < 2;
                })();
            } catch (e) { ok = false; }
            if (!ok) {
                try {
                    el.setAttribute('data-ssp-ctfix', '1');
                    el.style.setProperty(prop === 'fontSize' ? 'font-size' : prop, d[prop], 'important');
                    用了行内 = true;
                } catch (e) { }
            }
        }
    }
    return { rule, 用来行内: 用了行内 };
}
/** 撤掉所有兜底（样式表 + 行内），给「恢复」用 */
function sspCtFallbackClear() {
    const st = document.getElementById('ssp_contrast_fix');
    if (st) st.remove();
    const els = document.querySelectorAll('[data-ssp-ctfix]');
    for (const el of els) {
        try { el.style.removeProperty('color'); el.style.removeProperty('font-size'); el.removeAttribute('data-ssp-ctfix'); } catch (e) { }
    }
    return els.length;
}
function orbContrastHTML() {
    if (orbCtRows === null) { try { sspContrastRun(); } catch (e) { orbCtRows = []; } }
    const rows = orbCtRows || [];
    const bad = rows.filter(sspCtBad);
    const head = '<div class="ssp-ct-head ssp-bt-toggle" data-orb-ctopen="1" role="button" tabindex="0">'
        + '<i class="fa-solid ' + (orbCtOpen ? 'fa-caret-down' : 'fa-caret-right') + '"></i>'
        + '<b>看得清吗</b>'
        + '<small>' + (bad.length ? ('有 ' + bad.length + ' 处看不清（点标题展开）') : (rows.length ? '都看得清' : '点一下体检：正文/输入框/侧栏会不会看不见')) + '</small>'
        + '<span class="ssp-ct-arrow"><i class="fa-solid ' + (bad.length ? 'fa-triangle-exclamation' : 'fa-eye') + '"></i></span>'
        + '</div>';
    if (!orbCtOpen) return '<div class="ssp-ct' + (bad.length ? ' bad' : '') + '">' + head + '</div>';
    const list = rows.map((r, i) => {
        const 元凶 = r.元凶 || [];
        return '<div class="ssp-ct-row' + (sspCtBad(r) ? ' bad' : '') + '">'
            + '<span class="ssp-ct-name">' + esc(r.名字) + '</span>'
            + '<span class="ssp-ct-cr" title="' + esc(r.前景 + ' on ' + r.背景) + '">' + r.对比度.toFixed(2) + ':1'
            + (r.有图 ? '<i title="这一处底下有背景图，数值仅供参考">※</i>' : '') + '</span>'
            + '<span class="ssp-ct-fs' + (r.太小 ? ' bad' : '') + '"'
            + ' title="' + esc('字号 ' + r.字号 + 'px' + (r.行高 ? '／行高 ' + r.行高 + 'px' : '')
                + (r.太小 ? '（小于 ' + SSP_CT_MIN_PX + 'px 就太小了）' : '') + (r.太挤 ? '（行高太挤）' : '')) + '">'
            + esc(r.字号 ? r.字号 + 'px' : '—') + '</span>'
            + '<span class="ssp-ct-swatch" style="background:' + esc(r.背景) + ';color:' + esc(r.前景) + '">字</span>'
            + (元凶.length
                ? ('<code class="ssp-ct-blame" title="命中的规则：' + esc(元凶[0].sel) + '">' + esc(元凶[0].k) + '</code>')
                : '<code class="ssp-ct-blame none" title="没找到是哪条变量在管它（可能写死在具体选择器上了）">没定位到</code>')
            + (sspCtBad(r)
                ? '<span class="ssp-pbtn" data-orb-ctfix="' + i + '">修一下</span>'
                : '')
            + '</div>';
    }).join('');
    /* 「写回主题」放在脚上、而且只要这个美化有覆盖就出现：
       修完那行就不"红"了，按钮要是挂在行上会跟着消失，人就没机会写回了。 */
    const ovN = Object.keys(themeVarsOf()).length;
    return '<div class="ssp-ct' + (bad.length ? ' bad' : '') + '">' + head
        + '<div class="ssp-ct-body">'
        + '<div class="ssp-ct-note">量的是真颜色（`color` 和往上第一个不透明背景）、还有字号 —— 不是猜变量名。'
        + '对比度低于 3:1、或字号小于 ' + SSP_CT_MIN_PX + 'px 都算看不清；※ 表示那底下有背景图，数值只能参考。</div>'
        + (list || '<div class="ssp-orb-empty">当前没有可量的位置（先打开一个聊天再看看）。</div>')
        + '<div class="ssp-ct-foot">'
        + '<span class="ssp-pbtn" data-orb-ctcheck="1">重新体检</span>'
        + '<span class="ssp-pbtn" data-orb-ctblame="1" title="对着看不清的那几处，去主题 CSS 里找是哪条变量在管">找元凶</span>'
        + (ovN ? '<span class="ssp-pbtn" data-orb-ctwrite="1" title="把覆盖层的值写回主题 CSS（改的是你的美化文件，要你自己点）">写回主题（' + ovN + ' 条）</span>' : '')
        + '</div></div></div>';
}

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
        const mkey = personaChatKeyOf(ch.avatar, x.file);
        const mpid = personaChatBindOf(mkey);
        return '<div class="ssp-orb-prow' + (on ? ' on' : '') + '">'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(x.name) + (on ? '<span class="ssp-orb-ptag">当前</span>' : '') + '</div>'
            + (x.time ? '<div class="ssp-orb-pdesc">' + esc(String(x.time).slice(0, 70)) + '</div>' : '')
            + (mpid ? '<div class="ssp-orb-pbind has"><i class="fa-solid fa-masks-theater"></i>' + esc(dlcPersonaName(mpid)) + '</div>' : '')
            + '</div>'
            + '<div class="ssp-orb-pacts">'
            + '<span class="ssp-pbtn ssp-chat-mask' + (mpid ? ' bound' : '') + '" data-orb-chatmask="' + esc(mkey) + '"'
            + ' title="给这份存档指定面具（切过去自动戴；存档优先于角色卡）">' + (mpid ? '🎭' : '🎭 绑面具') + '</span>'
            + '<span class="ssp-pbtn' + (on ? ' primary' : '') + '" data-orb-chatload="' + esc(x.file) + '">' + (on ? '当前' : '读档') + '</span>'
            + '<span class="ssp-pbtn" data-orb-chatren="' + esc(x.file) + '" data-orb-chatname="' + esc(x.name) + '"><i class="fa-solid fa-pen"></i></span>'
            + '<span class="ssp-pbtn danger" data-orb-chatdel="' + esc(x.file) + '" data-orb-chatname="' + esc(x.name) + '"><i class="fa-solid fa-trash"></i></span>'
            + '</div></div>';
    }).join('');
    return head + '<div class="ssp-orb-plist">' + rows + '</div>';
}

function orbChatHTML() {
    /* v1.31.64：正在给某份存档挑面具 → 整页换成挑面具的界面 */
    if (personaChatMaskKey) return orbChatMaskPickerHTML(personaChatMaskKey);
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
/* 美化「编辑口」：在面板里直接改 CSS，边改边看效果。
   · 实时预览 = 写进酒馆自己的 <style id="custom-style">（它的 applyCustomCSS 用的就是这一个）
   · 更新当前 / 另存为新美化 / 导出 = 去点酒馆自己的 #ui-preset-update-button / save / export 按钮
     （不重写逻辑，跟角色面板那边的做法一致：能点酒馆自己的就点它） */
var orbThemeEdit = false;    // 是否在编辑模式
var orbThemeDraft = null;    // 编辑中的 CSS 草稿（null = 还没读进来）

function orbThemeSel() { return document.getElementById('themes'); }
/** 美化列表：读酒馆 #themes 下拉。
    ⚠️ 酒馆自己的 saveTheme 在同名时会往 themes 数组里再 push 一个 → 下拉里出现两个同名 option，
       面板就渲染成两行、两行都标「当前」（用户截图反馈过："点应用没问题，是显示问题"）。
       这里按名字去重，并顺手把**多余的、且没被选中的**那些 option 拔掉（当前选中的一律不动）。 */
function orbThemeList() {
    const sel = orbThemeSel();
    if (!sel) return [];
    const seen = new Set();
    const out = [];
    const drop = [];
    Array.from(sel.options).forEach(o => {
        const n = (o.textContent || '').trim();
        if (!n) return;
        if (seen.has(n)) { if (!o.selected) drop.push(o); return; }
        seen.add(n);
        out.push(n);
    });
    if (drop.length) { try { drop.forEach(o => o.remove()); } catch (e) { } }
    return out;
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
            + (on ? '<span class="ssp-pbtn" data-orb-thedit="1" title="改这个美化（自定义 CSS，边改边看）"><i class="fa-solid fa-pen-ruler"></i>改</span>' : '')
            + '<span class="ssp-pbtn" data-orb-tbind="' + esc(n) + '"><i class="fa-solid fa-link"></i>绑定</span>'
            + '</div></div>';
    }).join('');
    return head + '<div class="ssp-orb-plist">' + rows + '</div>';
}
/* ⚠️ 「常用开关」要**不管有没有美化主题都渲染出来**：v1.31.58 起托盘的开关就放在这里面，
   而冷启动/主题列表还没拉回来时（实测无头浏览器就是）`#themes` 是空的 ——
   以前这里直接 return 列表，整块「常用开关」跟着一起消失，用户就找不到开关了。 */
/* ============================ 主题变量（美化页 · v1.31.72）============================
   用户要的：切到某个美化时，如果它写了 `:root{…}` 这种**全局变量**，就能直接在鼠鼠面板里调。

   做法（用户选的"覆盖层 + 一键写回"）：
     · 从**当前美化 CSS** 里只扒 `:root` / `html` 两个选择器的变量（别的不算"全局"）
     · 调过的值存 `s.themeVars[主题名][--变量] = 值`，最后注入一条自己的 `:root{…}` 样式（放 head 末尾，优先级最高）
       → 不动主题文件、随时还原、换主题互不影响
     · 想固化就点「写回主题」：把覆盖值写进主题 CSS 再走酒馆自己的"更新当前美化"
     · 控件按值自动选：颜色→取色器；px / em / % → 滑块；其它→文本框
     · 自动按名字前缀分组 + 搜索（有的主题 :root 里几十上百个）
   ========================================================================== */
var orbTVSearch = '';
var orbTVCat = 'all';           // v1.31.81：类别页签（全部/颜色/字号尺寸/字体/其它）
var orbTVDictOpen = false;      // v1.31.79：词表（改中文名 / 导入导出）那块要不要展开
var orbTVOpen = true;

function themeVarsBinds() {
    const s = getSettings();
    if (!s.themeVars || typeof s.themeVars !== 'object' || Array.isArray(s.themeVars)) s.themeVars = {};
    return s.themeVars;
}
function themeVarsOf(name) {
    const b = themeVarsBinds();
    const k = String(name || orbThemeCur() || '(未命名)');
    if (!b[k] || typeof b[k] !== 'object' || Array.isArray(b[k])) b[k] = {};
    return b[k];
}
/** 只扒 :root / html 里的 --变量（返回 [{k,v}]，同名以第一次出现为准）
    ⚠️ 选择器前面**不能**要求"行首或 }"：实测用户的主题是把变量块写在注释结尾之后
       （注释用星斜杠收尾，紧跟着 :root ），那种写法一条都匹配不到 —— 用户反馈"感觉没抓到"。
       所以改成"前面不是字母数字/横线就算"，注释结尾那个斜杠也能过。 */
function themeVarsParse(css) {
    const out = [];
    const seen = new Set();
    const txt = String(css || '');
    let m;
    const blockRe = /(?:^|[^\w-])(:root|html)\b([^{}]*)\{([^}]*)\}/gi;
    while ((m = blockRe.exec(txt))) {
        const body = m[3] || '';
        const declRe = /(--[\w-]+)\s*:\s*([^;}]+)/g;
        let d;
        while ((d = declRe.exec(body))) {
            const k = d[1];
            /* 值里常带 !important：控件里显示干净值，写回时再把 !important 保留住 */
            const v = String(d[2]).replace(/\s*!\s*important\s*$/i, '').trim();
            if (!k || seen.has(k)) continue;
            seen.add(k);
            out.push({ k: k, v: v });
        }
    }
    return out;
}
function themeVarKind(v) {
    const s = String(v || '').trim();
    if (/^#([0-9a-f]{3,8})$/i.test(s) || /^(rgb|hsl)a?\s*\(/i.test(s)) return 'color';
    if (/^-?\d+(\.\d+)?px$/i.test(s)) return 'px';
    if (/^-?\d+(\.\d+)?(em|rem)$/i.test(s)) return 'em';
    if (/^-?\d+(\.\d+)?%$/.test(s)) return 'pct';
    if (/^-?\d+(\.\d+)?$/.test(s)) return 'num';
    return 'text';
}
function themeVarColorOf(v) {
    const s = String(v || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
    if (m) return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
    return '#ffffff';
}
/** 值 + 单位拆开（滑块要用数字） */
function themeVarNumOf(v) {
    const m = /^(-?\d+(?:\.\d+)?)\s*([a-z%]*)$/i.exec(String(v || '').trim());
    return m ? { n: Number(m[1]), unit: m[2] || '' } : { n: 0, unit: '' };
}
/** 把覆盖值注入一条自己的 :root 样式（放最后，优先级最高） */
function themeVarsApply() {
    try {
        const ov = themeVarsOf();
        const keys = Object.keys(ov).filter(k => k && typeof ov[k] === 'string' && ov[k] !== '');
        let el = document.getElementById('ssp_theme_vars_style');
        if (!keys.length) { if (el) el.remove(); return false; }
        if (!el) {
            el = document.createElement('style');
            el.id = 'ssp_theme_vars_style';
            (document.head || document.body).appendChild(el);
        }
        el.textContent = ':root{\n' + keys.map(k => '  ' + k + ': ' + ov[k] + ' !important;').join('\n') + '\n}';
        return true;
    } catch (e) { return false; }
}
/** 把覆盖值写回主题 CSS（再做酒馆自己的「更新当前美化」） */
function themeVarsWriteBack() {
    try {
        const ov = themeVarsOf();
        const keys = Object.keys(ov);
        if (!keys.length) { toast('还没有调过任何变量', 'info'); return false; }
        let css = String(orbThemeCss() || '');
        keys.forEach(k => {
            /* 只替换"值"那一段，保留原来的 !important（主题很多变量靠它压过别人的规则） */
            const re = new RegExp('(' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*)([^;}!]+)', 'g');
            if (re.test(css)) { re.lastIndex = 0; css = css.replace(re, function (m0, p1) { return p1 + ov[k] + ' '; }); }
        });
        orbThemePreview(css);
        orbThemeSyncToSt(css);
        try { orbThemeClickSt('ui-preset-update-button'); } catch (e) { }
        toast('已把调过的 ' + keys.length + ' 个变量写回当前美化', 'success');
        return true;
    } catch (e) { toast('写回失败：' + (e && e.message), 'warning'); return false; }
}

/* ============================ 变量中文化（v1.31.79） ============================
   变量名（--SmartThemeBodyColor / --float-bar-bottom-dist）对用户就是天书。这里三层：
     ① 词典：把名字拆成词（驼峰 + 横线），逐词查中文 → "悬浮栏·离底距离"
     ② 别名：用户/作者可以给某个变量起自己的名字，存在 s.varAlias[美化名][变量]
     ③ 词表：词典 + 别名能导出成 JSON 发给别人（也能跟美化一起发），再载回来
   原则：**翻译不出来就原样显示**，绝不硬凑；变量值一律不翻（那是 CSS 值，翻了就错）。
   ========================================================================== */
const SSP_VAR_DICT = {
    /* 通用 */
    body: '正文', color: '颜色', colour: '颜色', bg: '背景', background: '背景', bgcolor: '背景色',
    tint: '底色', blur: '模糊', chat: '聊天', mes: '消息', message: '消息', user: '用户', bot: '机器人',
    border: '边框', quote: '引用', em: '强调', font: '字体', text: '文字', fill: '填充', ink: '墨色',
    line: '线条', accent: '强调色', white: '白色', shadow: '阴影', glow: '光晕', highlight: '高亮',
    /* 颜色词（美化常用） */
    pitch: '主色', ash: '灰', bone: '骨白', crimson: '绯红', gold: '金', green: '绿', panel: '面板色',
    red: '红', blue: '蓝', yellow: '黄', purple: '紫', pink: '粉', gray: '灰', grey: '灰', black: '黑',
    dark: '深', light: '浅', warm: '暖', cool: '冷',
    /* 位置与尺寸 */
    top: '顶部', bottom: '底部', left: '左', right: '右', side: '侧', bar: '栏', form: '输入区',
    block: '区块', size: '尺寸', width: '宽', height: '高', min: '最小', max: '最大', gap: '间距',
    padding: '内边距', margin: '外边距', offset: '偏移', dist: '距离', distance: '距离', space: '空间',
    inner: '内部', outer: '外部', radius: '圆角', width: '宽', layer: '图层', row: '行', column: '列',
    /* 部件 */
    btn: '按钮', button: '按钮', send: '发送', stop: '中止', action: '操作', qr: '快捷回复',
    rocket: '火箭', icon: '图标', label: '标签', options: '选项', ext: '扩展', menu: '菜单',
    float: '悬浮栏', input: '输入框', avatar: '头像', card: '卡片', tab: '页签', tabs: '页签',
    /* 状态与杂项 */
    hover: '悬停', focus: '聚焦', active: '激活', divider: '分隔线', toast: '气泡提示', count: '数量',
    hd: '高清', ease: '缓动', mono: '等宽', display: '标题', cut: '裁切', smarttheme: '酒馆主题',
    st: '主题', theme: '主题', scale: '缩放', opacity: '不透明度', speed: '速度', delay: '延迟',
    anim: '动画', transition: '过渡', mode: '模式', align: '对齐', center: '居中', list: '列表',
};
function sspDictUser() {
    const s = getSettings();
    if (!s.varDictUser || typeof s.varDictUser !== 'object' || Array.isArray(s.varDictUser)) s.varDictUser = {};
    return s.varDictUser;
}
function sspDictOf(token) {
    const t = String(token || '').toLowerCase();
    const u = sspDictUser()[t];
    if (typeof u === 'string' && u) return u;
    return SSP_VAR_DICT[t] || '';
}
/** --SmartThemeBodyColor → ['smart','theme','body','color']；--float-bar-bottom-dist → ['float','bar','bottom','dist'] */
function sspNameTokens(raw) {
    const name = String(raw || '').replace(/^--/, '');
    const out = [];
    name.split(/[-_]+/).forEach(part => {
        if (!part) return;
        /* 驼峰再拆一遍：SmartThemeBodyColor → Smart / Theme / Body / Color */
        (part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) || [part]).forEach(t => out.push(t.toLowerCase()));
    });
    return out;
}
function sspVarAliasMap() {
    const s = getSettings();
    if (!s.varAlias || typeof s.varAlias !== 'object' || Array.isArray(s.varAlias)) s.varAlias = {};
    return s.varAlias;
}
function sspVarAliasOf(k) {
    const m = sspVarAliasMap()[String(orbThemeCur() || '(未命名)')];
    return (m && typeof m[k] === 'string') ? m[k] : '';
}
function sspVarAliasSet(k, v) {
    const all = sspVarAliasMap();
    const key = String(orbThemeCur() || '(未命名)');
    if (!all[key] || typeof all[key] !== 'object') all[key] = {};
    const name = String(v || '').trim();
    if (name) all[key][k] = name; else delete all[key][k];
    save();
    return name;
}
/** 变量的中文显示名（没有就返回空串，调用方回退成原名）
    ⚠️ 只按词翻会念出怪名字（SmartThemeBodyColor → 主题·正文·颜色），所以再加两条：
       ① 相邻词先拼短语（top+bar → 顶栏、bottom+form → 底部输入区…）
       ② `SmartTheme` 是酒馆自己的前缀、不是用户要的信息，直接丢掉；
          结尾那个"颜色"在已经有别的词时也算废话（要"模糊·底色"，不要"模糊·底色·颜色"）。 */
const SSP_VAR_PAIRS = {
    'top|bar': '顶栏', 'bottom|form': '底部输入区', 'block|size': '区块尺寸', 'float|bar': '悬浮栏',
    'qr|bar': '快捷回复栏', 'border|color': '边框颜色', 'font|color': '字体颜色', 'background|color': '背景色',
    'blur|tint': '模糊底色', 'chat|tint': '聊天底色',
    'top|btn': '顶栏按钮', 'send|btn': '发送按钮', 'stop|btn': '中止按钮', 'action|btn': '操作按钮',
    'float|input': '悬浮输入框', 'rocket|icon': '火箭图标', 'group|divider': '分组分隔线',
};
function sspVarNameCN(k) {
    const alias = sspVarAliasOf(k);
    if (alias) return alias;
    let toks = sspNameTokens(k);
    if (toks.length > 2 && toks[0] === 'smart' && toks[1] === 'theme') toks = toks.slice(2);
    const parts = [];
    for (let i = 0; i < toks.length; i++) {
        const three = toks[i] + '|' + toks[i + 1] + '|' + toks[i + 2];
        const two = toks[i] + '|' + toks[i + 1];
        if (SSP_VAR_PAIRS[three]) { parts.push(SSP_VAR_PAIRS[three]); i += 2; continue; }
        if (SSP_VAR_PAIRS[two]) { parts.push(SSP_VAR_PAIRS[two]); i += 1; continue; }
        const c = sspDictOf(toks[i]);
        if (c) parts.push(c);
    }
    const last = parts[parts.length - 1] || '';
    if (parts.length >= 2 && (/^颜色$/.test(last) && parts.slice(0, -1).some(p => /色$|底色$/.test(p)) || (parts.length > 2 && /^(尺寸|间距)$/.test(last)))) parts.pop();
    const uniq = [];
    parts.forEach(p => { if (uniq.indexOf(p) < 0) uniq.push(p); });
    return uniq.length ? uniq.join('·') : '';
}
/** 分组名（p5 / float / top / smarttheme …）也翻成中文；翻不出来就原样 */
function sspGroupNameCN(g) {
    const raw = String(g || '');
    /* 组名本来就是变量名的前缀，翻译规则跟变量名一样（顶栏 / 悬浮栏 / 快捷回复栏 …） */
    const cn = sspVarNameCN(raw) || sspVarNameCN('--' + raw);
    return cn || raw;
}
function sspVarDictJSON() {
    const key = String(orbThemeCur() || '(未命名)');
    const alias = sspVarAliasMap()[key] || {};
    return JSON.stringify({
        说明: '鼠鼠小助手 · 变量中文名词表。词典=通用词，别名=这个美化专用的名字。可以改完发人。',
        美化: key,
        词典: Object.assign({}, SSP_VAR_DICT, sspDictUser()),
        别名: alias,
    }, null, 2);
}
/** 载入一份词表（只认 词典 / 别名 两个键；坏的 JSON 不会把设置搞乱） */
function sspVarDictLoad(txt) {
    let j = null;
    try { j = JSON.parse(String(txt || '')); } catch (e) { return { ok: false, msg: '不是合法的 JSON' }; }
    if (!j || typeof j !== 'object') return { ok: false, msg: 'JSON 里没有对象' };
    let nDict = 0, nAlias = 0;
    if (j.词典 && typeof j.词典 === 'object') {
        const u = sspDictUser();
        Object.keys(j.词典).forEach(k => {
            const v = j.词典[k];
            if (typeof v === 'string' && v.trim() && v !== SSP_VAR_DICT[String(k).toLowerCase()]) { u[String(k).toLowerCase()] = v.trim(); nDict++; }
        });
    }
    if (j.别名 && typeof j.别名 === 'object') {
        const all = sspVarAliasMap();
        const key = String(j.美化 || orbThemeCur() || '(未命名)');
        if (!all[key] || typeof all[key] !== 'object') all[key] = {};
        Object.keys(j.别名).forEach(k => {
            const v = j.别名[k];
            if (typeof v === 'string') {
                if (v.trim()) all[key][k] = v.trim(); else delete all[key][k];
                nAlias++;
            }
        });
    }
    save();
    return { ok: true, msg: '载入完成：词典 ' + nDict + ' 条、别名 ' + nAlias + ' 条' };
}

/** v1.31.81：一个变量属于哪一类 —— 用户要的是「一眼看出哪个是颜色、哪个是字号」。
    判定顺序：颜色 > 尺寸 > 字体 > 其它（名字里带 color/bg 的，即使值是 var(--x) 也算颜色）。 */
const SSP_TV_CATS = [['all', '全部'], ['color', '颜色'], ['size', '字号·尺寸'], ['font', '字体'], ['other', '其它']];
function sspVarCat(k, val) {
    const name = String(k || '').toLowerCase();
    const kind = themeVarKind(val);
    if (kind === 'color') return 'color';
    if (/color|colour|bg|background|tint|ink|fill|glow|shadow/.test(name)) return 'color';
    if (kind === 'px' || kind === 'em' || kind === 'pct') return 'size';
    if (/font|family|mono|display|cut|weight|serif|sans/.test(name)) return 'font';
    return 'other';
}
function sspVarCatTag(cat) { return ({ color: '🎨', size: '📐', font: '🅰', other: '✨' })[cat] || '·'; }

/** 美化页里那块「主题变量」 */
function orbThemeVarsHTML() {
    const cur = orbThemeCur() || '(读不到当前美化)';
    const all = themeVarsParse(orbThemeCss());
    const ov = themeVarsOf();
    const ovN = Object.keys(ov).length;
    const q = String(orbTVSearch || '').trim().toLowerCase();
    /* v1.31.81：先按类别归类（页签要用），再跟搜索一起筛 */
    const catOf = new Map();
    const catN = { all: all.length, color: 0, size: 0, font: 0, other: 0 };
    all.forEach(v => { const c = sspVarCat(v.k, v.v); catOf.set(v.k, c); catN[c] = (catN[c] || 0) + 1; });
    /* v1.31.79：搜索同时匹 英文原名 / 中文名 / 别名（用户不该被迫记英文） */
    const hit = all.filter(v => (orbTVCat === 'all' || catOf.get(v.k) === orbTVCat) && (!q
        || v.k.toLowerCase().indexOf(q) >= 0
        || sspVarNameCN(v.k).toLowerCase().indexOf(q) >= 0));
    const head = '<div class="ssp-tv-head">'
        + '<span class="ssp-tv-title">🎨 主题变量' + (all.length ? '（' + all.length + ' 个）' : '') + '</span>'
        + '<span class="ssp-tv-exp" title="此功能为实验性功能，不能保证能全都修改">实验性</span>'
        + (ovN ? '<span class="ssp-tv-badge">已改 ' + ovN + '</span>' : '')
        + '<span class="ssp-sp"></span>'
        + (ovN ? '<span class="ssp-pbtn" data-orb-tvwrite="1" title="把调过的值写进主题 CSS，并点酒馆自己的「更新当前美化」（实验性：只管 :root/html 里的变量）">写回主题</span>' : '')
        + (ovN ? '<span class="ssp-pbtn" data-orb-tvall="1" title="把所有变量还原成主题原值">全部还原</span>' : '')
        + '<span class="ssp-pbtn" data-orb-tvfold="1">' + (orbTVOpen ? '收起' : '展开') + '</span>'
        + '</div>';
    if (!all.length) {
        return head + (orbTVOpen ? '<div class="ssp-orb-empty" style="padding:2px 2px 6px">当前美化里没有 <b>:root</b> / <b>html</b> 变量 —— '
            + '这个美化把值写死在具体选择器上了，所以没得调。</div>' : '');
    }
    if (!orbTVOpen) return head;
    const rawOn = getSettings().varShowRaw !== false;
    const tabs = '<div class="ssp-tv-cats">' + SSP_TV_CATS.map(([k, label]) =>
        '<span class="ssp-tv-cat' + (k === orbTVCat ? ' on' : '') + '" data-orb-tvcat="' + k + '">'
        + label + '<i>' + (k === 'all' ? all.length : (catN[k] || 0)) + '</i></span>').join('') + '</div>';
    const note = '<div class="ssp-tv-expnote">⚠️ 此功能为实验性功能，不能保证能全都修改。'
        + '这里只能调美化作者写进 <b>:root</b> / <b>html</b> 的变量；写死在具体选择器上的值（比如这套美化的正文字号）它就管不到 —— '
        + '遇到这种情况用上面「看得清吗」里的兜底修法。</div>';
    const tools = note + tabs + '<div class="ssp-orb-pfilter" style="margin-bottom:4px">'
        + '<input class="ssp-inp" type="text" data-orb-tvsearch="1" placeholder="搜中文名或变量名（比如 正文 / --accent）" value="' + esc(orbTVSearch) + '">'
        + (orbTVSearch ? '<span class="ssp-pbtn" data-orb-tvsearchclear="1">清除</span>' : '')
        + '</div>'
        + '<div class="ssp-tv-tools">'
        + '<span class="ssp-pbtn" data-orb-tvraw="1" title="点一下切换：变量名后面要不要跟英文原名">'
        + (rawOn ? '✓ 显示英文原名' : '只显示中文名') + '</span>'
        + '<span class="ssp-pbtn" data-orb-tvdict="1" title="改中文名 / 导入导出词表">词表（' + (Object.keys(sspVarAliasMap()[cur] || {}).length + Object.keys(sspDictUser()).length) + '）</span>'
        + '</div>'
        + (orbTVDictOpen
            ? ('<div class="ssp-tv-dictbox">'
                + '<div class="ssp-tv-dictnote">点变量名可以直接改它的中文名（留空＝恢复默认）。下面这份是词表：'
                + '词典＝通用词，别名＝这个美化专用的名字，可以导出给别的美化作者 / 发给别人。</div>'
                + '<textarea class="ssp-inp ssp-tv-json" data-orb-tvjson="1" spellcheck="false" rows="9">' + esc(sspVarDictJSON()) + '</textarea>'
                + '<div class="ssp-tv-dictfoot">'
                + '<span class="ssp-pbtn" data-orb-tvjsonload="1">载入这份</span>'
                + '<span class="ssp-pbtn" data-orb-tvjsondown="1">下载 JSON</span>'
                + '<span class="ssp-pbtn" data-orb-tvjsonreset="1" title="把词典恢复成内置的（别名不动）">词典复位</span>'
                + '</div></div>')
            : '');
    if (!hit.length) {
        return head + tools + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">'
            + (orbTVSearch ? '没有匹配「' + esc(orbTVSearch) + '」的变量。'
                : ('这一类里没有变量（' + esc((SSP_TV_CATS.filter(x => x[0] === orbTVCat)[0] || ['', ''])[1]) + '）。'))
            + '</div>';
    }
    const groups = new Map();
    /* 分组：`--p5-pitch` 这种按第一个横线前的词分（p5）；
       `--SmartThemeBodyColor` 这种没有横线的，按同族（公共前缀）并成一组，
       否则 10 个 SmartTheme 变量会变成 10 个「一组一个」的组头，白占一大截高度。 */
    const lcpOf = (arr) => arr.reduce((p, c) => {
        let i = 0;
        const n = Math.min(p.length, c.length);
        while (i < n && p[i] === c[i]) i++;
        return p.slice(0, i);
    });
    const famCut = (s) => {   // "SmartThemeB" → "SmartTheme"（切掉半个词）；"SmartTheme" 原样留着
        const t = String(s);
        return /.[A-Z]$/.test(t) ? t.slice(0, -1) : t;
    };
    const bucket = new Map();
    hit.forEach(v => {
        const n = v.k.replace(/^--/, '');
        if (n.indexOf('-') >= 0) return;
        const b = n.slice(0, 4).toLowerCase();
        if (!bucket.has(b)) bucket.set(b, []);
        bucket.get(b).push(n);
    });
    const nameGroup = new Map();
    bucket.forEach(names => {
        const pre = names.length > 1 ? (famCut(lcpOf(names)) || names[0]) : names[0];
        names.forEach(n => nameGroup.set(n, pre));
    });
    const 组原名 = new Map();      // 小写 key → 原始大小写（翻译要原始大小写，小写拆不出驼峰）
    hit.forEach(v => {
        const n = v.k.replace(/^--/, '');
        const i = n.indexOf('-');
        const raw = (i > 0 ? n.slice(0, i) : (nameGroup.get(n) || n));
        const g = raw.toLowerCase();
        if (!groups.has(g)) { groups.set(g, []); 组原名.set(g, raw); }
        groups.get(g).push(v);
    });
    const rowsHTML = (arr) => arr.map(v => {
        const now = ov[v.k];
        const val = (now === undefined) ? v.v : now;
        const kind = themeVarKind(v.v);
        const changed = now !== undefined && now !== v.v;
        /* ⚠️ 全部用**行内 !important**：用户的 `仿p5` 主题全局样式很凶，
           之前用 class 布局时整行只剩一条空条（实测两次）。行内 !important 它压不掉。 */
        const S_K = 'display:inline-block !important;flex:0 0 42% !important;max-width:42% !important;'
            + 'font-family:Consolas,Monaco,monospace !important;font-size:10.5px !important;line-height:1.7 !important;'
            + 'color:#d0d0dc !important;opacity:1 !important;overflow:hidden !important;'
            + 'text-overflow:ellipsis !important;white-space:nowrap !important;';
        const S_CTL = 'display:flex !important;align-items:center !important;gap:6px !important;'
            + 'flex:1 1 auto !important;min-width:0 !important;';
        const S_ROW = 'display:flex !important;align-items:center !important;gap:8px !important;'
            + 'padding:4px 9px !important;min-height:28px !important;'
            + 'border-top:1px solid rgba(255,255,255,.07) !important;'
            + 'background:' + (changed ? 'rgba(120,190,255,.08)' : 'transparent') + ' !important;';
        let ctl = '';
        if (kind === 'color') {
            ctl = '<input type="color" data-orb-tvk="' + esc(v.k) + '" value="' + esc(themeVarColorOf(val)) + '"'
                + ' title="' + esc(val) + '" style="flex:0 0 auto !important;width:32px !important;height:22px !important;'
                + 'padding:0 !important;border:1px solid rgba(255,255,255,.3) !important;border-radius:3px !important;'
                + 'background:#222 !important;cursor:pointer !important;display:inline-block !important;">'
                + '<code style="font-size:10px !important;color:#9a9ab0 !important;background:transparent !important;'
                + 'border:0 !important;padding:0 !important;border-radius:0 !important;box-shadow:none !important;'
                + 'font-family:Consolas,Monaco,monospace !important;">' + esc(val) + '</code>';
        } else if (kind === 'px' || kind === 'em' || kind === 'pct') {
            const num = themeVarNumOf(val);
            const max = kind === 'px' ? Math.max(64, Math.round(num.n * 2) + 32)
                : kind === 'em' ? Math.max(4, num.n * 2 + 2) : 100;
            const step = kind === 'px' ? 1 : (kind === 'pct' ? 1 : 0.05);
            ctl = '<input type="range" data-orb-tvk="' + esc(v.k) + '" data-orb-tvunit="' + esc(num.unit || kind) + '"'
                + ' min="0" max="' + max + '" step="' + step + '" value="' + num.n + '"'
                + ' style="flex:1 1 auto !important;min-width:60px !important;height:18px !important;'
                + 'accent-color:#6ea8ff !important;display:inline-block !important;">'
                + '<b data-orb-tvout="' + esc(v.k) + '" style="flex:0 0 auto !important;font-size:10.5px !important;'
                + 'color:#a9a9ba !important;font-weight:400 !important;min-width:46px !important;text-align:right !important;">'
                + esc(val) + '</b>';
        } else {
            ctl = '<input type="text" data-orb-tvk="' + esc(v.k) + '" value="' + esc(val) + '"'
                + ' style="flex:1 1 auto !important;min-width:0 !important;font-size:11px !important;padding:3px 6px !important;'
                + 'color:#e8e8ef !important;background:#15151c !important;border:1px solid rgba(255,255,255,.18) !important;'
                + 'border-radius:3px !important;display:inline-block !important;">';
        }
        /* v1.31.79：左边显示中文名，英文原名按开关跟在小字里；点一下可以改中文名 */
        const cn = sspVarNameCN(v.k);
        const rawOn = getSettings().varShowRaw !== false;
        const label = '<i class="ssp-tv-cat-tag">' + sspVarCatTag(sspVarCat(v.k, v.v)) + '</i>'
            + (cn || v.k) + (cn && rawOn ? ' <i class="ssp-tv-raw">' + esc(v.k) + '</i>' : '');
        const labelTitle = (cn ? cn + '\n' + v.k : v.k) + ' = ' + v.v + '\n（点一下可以给它起个中文名）';
        return '<div data-orb-tvrow="' + esc(v.k) + '" style="' + S_ROW + '">'
            + '<span class="ssp-tv-k" data-orb-tvrename="' + esc(v.k) + '" title="' + esc(labelTitle) + '" style="' + S_K + '">'
            + label + '</span>'
            + '<span style="' + S_CTL + '">' + ctl + '</span>'
            + (changed ? '<span class="ssp-pbtn ssp-tv-reset" data-orb-tvr="' + esc(v.k) + '" title="还原成主题原值">↺</span>' : '')
            + '</div>';
    }).join('');
    const body = [...groups.entries()].map(([g, arr]) => '<div class="ssp-tv-group">'
        + '<div class="ssp-tv-ghead" title="' + esc(组原名.get(g) || g) + '">' + esc(sspGroupNameCN(组原名.get(g) || g)) + '<i>· ' + arr.length + ' 个</i></div>'
        + rowsHTML(arr) + '</div>').join('');
    return head + tools + '<div class="ssp-tv-body">' + body + '</div>';
}

function orbThemeHTML() {
    if (orbThemeEdit) return orbThemeEditHTML();
    if (orbThemeBinding) return orbThemePickerHTML(orbThemeBinding);
    if (!orbThemeList().length) return orbBeautyHTML() + orbThemeRowsHTML();
    return '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-thsearch="1" placeholder="搜主题 / 角色卡" value="' + esc(orbThSearch) + '">'
        + (orbThSearch ? '<span class="ssp-pbtn" data-orb-thclear="1">清除</span>' : '')
        + '</div>'
        + '<div class="ssp-orb-pcount"><label class="ssp-orb-auto"><input type="checkbox" data-orb-thauto="1"'
        + (orbThemeAuto() ? ' checked' : '') + '><span>切到绑定的角色时自动换美化（会弹提示）</span></label></div>'
        + '<div class="ssp-orb-pcount">'
        + '<span class="ssp-pbtn primary" data-orb-thedit="1"><i class="fa-solid fa-pen-ruler"></i>改当前美化（CSS）</span>'
        + '<span class="ssp-pbtn" data-orb-thcreate="1"><i class="fa-solid fa-plus"></i>新建美化</span>'
        + '<span class="ssp-pbtn" data-orb-thexport="1"><i class="fa-solid fa-file-export"></i>导出当前美化</span>'
        + '</div>'
        + orbBeautyHTML()
        /* v1.31.72：主题变量（:root / html 里的全局变量）就地调整 */
        + orbThemeVarsHTML()
        + '<div id="ssp_orb_theme_list">' + orbThemeRowsHTML() + '</div>'
        + '<div class="ssp-orb-empty" style="padding-top:6px">当前美化：<b>' + esc(orbThemeCur() || '(读不到)') + '</b>'
        + '；「用这个」立刻换，「绑定」选角色 —— <b>一个主题能绑多个角色卡</b>，一张角色卡只认一个主题。</div>';
}

/* ===== 美化「编辑口」：边改边看，满意了直接存成新美化 / 更新当前 / 导出 ===== */

/** 读到当前自定义 CSS。
    ⚠️ 有草稿就**一律用草稿**（编辑期间 DOM 里的 textarea 会随重画重建，
    从它读会读到旧值 —— 实测"更新完再进来看到的是旧的"就是这个原因）。
    ⚠️ 只有"正在编辑"时才用草稿：离开编辑后重烤主题，应该以酒馆那份为准。 */
function orbThemeCss() {
    if (orbThemeEdit && typeof orbThemeDraft === 'string') return orbThemeDraft;
    const ta = document.getElementById('customCSS');
    if (ta && typeof ta.value === 'string') return ta.value;
    const st = document.getElementById('custom-style');
    return st ? String(st.innerHTML || '') : '';
}
/** 实时预览：直接写进酒馆那个 <style id="custom-style">（它的 applyCustomCSS 用的就是这一个） */
function orbThemePreview(css) {
    try {
        let st = document.getElementById('custom-style');
        if (!st) {
            st = document.createElement('style');
            st.setAttribute('type', 'text/css');
            st.setAttribute('id', 'custom-style');
            document.head.appendChild(st);
        }
        st.innerHTML = String(css || '');
        return true;
    } catch (e) { return false; }
}
/** 让酒馆的 power_user.custom_css 也跟上（改那个 textarea 的 value 并派发 input，走它自己的处理器） */
function orbThemeSyncToSt(css) {
    const ta = document.getElementById('customCSS');
    if (!ta) return false;
    try {
        ta.value = String(css || '');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    } catch (e) { return false; }
}

/** 主题的 39 个字段（照酒馆 getThemeObject() 抄的，兜底用） */
const ORB_THEME_KEYS = ['name', 'blur_strength', 'main_text_color', 'italics_text_color', 'underline_text_color',
    'quote_text_color', 'blur_tint_color', 'chat_tint_color', 'user_mes_blur_tint_color', 'bot_mes_blur_tint_color',
    'shadow_color', 'shadow_width', 'border_color', 'font_scale', 'fast_ui_mode', 'waifuMode', 'avatar_style',
    'chat_display', 'toastr_position', 'noShadows', 'chat_width', 'timer_enabled', 'timestamps_enabled',
    'timestamp_model_icon', 'mesIDDisplay_enabled', 'hideChatAvatars_enabled', 'message_token_count_enabled',
    'expand_message_actions', 'enableZenSliders', 'enableLabMode', 'hotswap_enabled', 'custom_css', 'bogus_folders',
    'zoomed_avatar_magnification', 'reduced_motion', 'compact_input_area', 'show_swipe_num_all_messages',
    'click_to_edit', 'media_display'];

/** 组装一个"标准主题对象"。
    ⚠️ 别直接把 powerUserSettings 整个复制过来：那是 136 个键（含一堆跟主题无关的），
    酒馆自己的主题文件只有固定 39 个字段（实测 .Base_D.json）。结构不对的话
    以后切回这个主题会带进乱七八糟的设置。
    做法：先问酒馆要**当前主题文件**（/api/themes/get）照抄结构，拿不到才用 39 键白名单兜底。 */
async function orbThemeObject(name, css) {
    let base = null;
    try {
        const ctx = getContext() || {};
        const headers = Object.assign({ 'Content-Type': 'application/json' }, ctx.getRequestHeaders ? ctx.getRequestHeaders() : {});
        const cur = orbThemeCur();
        if (cur) {
            const r = await fetch('/api/themes/get', { method: 'POST', headers, body: JSON.stringify({ name: cur }) });
            if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') base = j; }
        }
    } catch (e) { }
    let src = base;
    if (!src) {
        let pu = {};
        try { pu = (getContext() || {}).powerUserSettings || {}; } catch (e) { }
        src = {};
        ORB_THEME_KEYS.forEach(k => { if (k in pu) src[k] = pu[k]; });
    }
    const t = {};
    ORB_THEME_KEYS.forEach(k => { if (k in src) t[k] = src[k]; });
    /* 白名单之外、但酒馆文件里确实有的字段也一并带上（版本不同字段会变，别丢） */
    Object.keys(src).forEach(k => { if (!(k in t) && k !== 'themes') t[k] = src[k]; });
    t.name = String(name || '').trim();
    if (typeof css === 'string') t.custom_css = css;
    return t;
}

/** 新建一个美化（主题）：把"现在这套设置"存成一个新主题。
    name 为空时用酒馆的输入弹窗问；建完自动切过去。返回新主题名或 null。 */
async function orbThemeCreate(name, css) {
    let nm = String(name || '').trim();
    if (!nm) {
        nm = await orbAskText('新美化叫什么？（会把「当前这套设置 + 你改的 CSS」存成一个新主题）', '');
        if (!nm) return null;
    }
    const body = await orbThemeObject(nm, typeof css === 'string' ? css : orbThemeCss());
    try {
        const ctx = getContext() || {};
        const headers = Object.assign({ 'Content-Type': 'application/json' }, ctx.getRequestHeaders ? ctx.getRequestHeaders() : {});
        const r = await fetch('/api/themes/save', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) { toast('新建失败：酒馆返回 ' + r.status, 'warning'); return null; }
        /* 把新主题补进下拉框并选中（酒馆自己的 saveTheme 就是这么做的） */
        const sel = orbThemeSel();
        if (sel && !Array.from(sel.options).some(o => (o.textContent || '').trim() === nm)) {
            const o = document.createElement('option');
            o.value = nm; o.textContent = nm;
            sel.appendChild(o);
        }
        orbThemePick(nm);
        toast('建好了新美化：' + nm + '（现在是它）', 'success');
        return nm;
    } catch (e) {
        toast('新建失败：' + (e && e.message), 'warning');
        return null;
    }
}
/** 点酒馆自己的按钮（更新当前 / 另存为新 / 导出）。返回按钮在不在。 */
function orbThemeClickSt(id) {
    const b = document.getElementById(id);
    if (!b) { toast('找不到酒馆的「' + id + '」按钮', 'warning'); return false; }
    try { b.click(); return true; } catch (e) { return false; }
}

function orbThemeEditHTML() {
    const css = orbThemeCss();
    const cur = orbThemeCur() || '(读不到)';
    const lines = String(css || '').split('\n').length;
    return '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-theditdone="1"><i class="fa-solid fa-arrow-left"></i>返回</span>'
        + '<b>改「' + esc(cur) + '」</b>'
        + '<span class="ssp-orb-charmark" style="margin-left:auto">' + lines + ' 行</span>'
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">'
        + '直接在下面改 <b>自定义 CSS</b> —— <b>边改边看</b>，改完点「更新当前美化」存回这个主题，'
        + '或者「另存为新美化」另起一个名字。<br>'
        + '<span style="opacity:.7">写的是酒馆主题里的「自定义 CSS」那一栏（和酒馆自己那套是同一份）。</span></div>'
        + '<textarea class="ssp-inp ssp-orb-ta ssp-theme-css" data-orb-thcss="1" rows="14" spellcheck="false"'
        + ' placeholder="/* 例：body { --SmartThemeBodyColor: #e8e8ee; } */">' + esc(css) + '</textarea>'
        + '<div class="ssp-orb-catpick" style="margin-top:6px">'
        + '<span class="ssp-pbtn primary" data-orb-thcssupdate="1"><i class="fa-solid fa-floppy-disk"></i>更新当前美化</span>'
        + '<span class="ssp-pbtn" data-orb-thcreate="1"><i class="fa-solid fa-plus"></i>存成新美化</span>'
        + '<span class="ssp-pbtn" data-orb-thexport="1"><i class="fa-solid fa-file-export"></i>导出</span>'
        + '<span class="ssp-pbtn danger" data-orb-thcssreset="1" title="放弃这次改动，读回酒馆里那份">还原</span>'
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding-top:6px">'
        + '⚠️ 改坏了不要紧：点「还原」把酒馆里存的那份读回来，或者用上面的「导出」先备份一下。<br>'
        + '「存成新美化」= 把<b>现在这套设置 + 你改的 CSS</b> 存成一个新主题（酒馆会问你名字），不会动你原来的美化。</div>';
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

/* ============================ 世界书栏（角色卡 → 多个世界书）============================
   用户要的：**一张角色卡绑多本世界书**，切到这张卡就都生效。

   ⚠️ 为什么不用酒馆原生的「Additional Lorebooks」：
     那份数据存在**客户端内存对象** world_info.charLore 里，而本扩展读不到它 ——
     实测（真页面 + CDP 探过）三条路全不通：
       · SillyTavern.getContext().worldInfo          → undefined
       · SillyTavern.getContext().powerUserSettings.world_info → undefined
       · getWorldInfoSettings()                      → 上下文里没有这个导出
     而且这份酒馆构建把角色面板的「Link to World Info」菜单项也注释掉了
     （script.js 里 `$('#set_character_world').on('click', ...)` 那行是注释状态），
     所以这条路彻底走不通，**做不到和酒馆原生绑定互通**（别去试，试过）。

   所以改成：**绑定表自己存**（s.worldBinds[角色文件名] = [书名…]），
   切角色时把绑定的书**加进当前聊天的生效列表**（酒馆自己的 #world_info 多选框）。

   「不污染」是这一栏的核心承诺 —— 扩展加进去的书会被记账（s.worldApplied[聊天id].prev），
   切走时**精确还原成你原来手动勾的那几本**：
     · 扩展只碰自己加进去/移除的那几本，你手动勾的别人一概不动
     · 切角色时把上一个聊天的账清掉（还原 + 删记录）
     · 面板里有「还原这个聊天」的手动出口，随时可退

   两个概念在面板上分开显示，不混为一谈：
     · **绑定**：这张角色卡配了哪几本（存扩展设置，跟着酒馆备份走、切角色永远在）
     · **本聊天生效**：酒馆那个多选框里现在勾着哪几本（绑定的 + 你自己勾的）
   ========================================================================== */

/** 角色卡标识 / 缓存键 —— 和酒馆 getCharaFilename() 一致：去掉图片扩展名（utils.js:1343） */
function orbWbCharKey(avatar) {
    const a = String(avatar || '');
    return a ? a.replace(/\.[^/.]+$/, '') : '';
}
/** 当前开着的聊天是哪个角色（拿不到就是 null） */
function orbWbCurChar() {
    try {
        const ctx = getContext() || {};
        const ch = (ctx.characters || [])[ctx.characterId];
        return ch && ch.avatar ? { id: ch.avatar, key: orbWbCharKey(ch.avatar), name: ch.name } : null;
    } catch (e) { return null; }
}
/** 当前聊天 id（拿不到返回空串）—— 换聊天要按它分别记账 */
function orbWbChatId() {
    try { return String((getContext() || {}).getCurrentChatId?.() || ''); } catch (e) { return ''; }
}
/** 记账表的键：一个角色可能有好几个聊天，所以按「角色文件::聊天id」分开记 */
function orbWbChatKey() {
    const ch = orbWbCurChar();
    if (!ch) return '';
    return ch.id + '::' + orbWbChatId();
}

/** 绑定表（角色文件名 → 书名数组）*/
function orbWbBinds() {
    const s = getSettings();
    if (!s.worldBinds || typeof s.worldBinds !== 'object' || Array.isArray(s.worldBinds)) s.worldBinds = {};
    return s.worldBinds;
}
/** 记账表（聊天键 → {prev:[…], ext:[…], at:时间}）*/
function orbWbApplied() {
    const s = getSettings();
    if (!s.worldApplied || typeof s.worldApplied !== 'object' || Array.isArray(s.worldApplied)) s.worldApplied = {};
    return s.worldApplied;
}
function orbWbRecord(key) { return key ? (orbWbApplied()[key] || null) : null; }

/** 某张角色卡绑了哪几本书（读的时候就去重，写脏了也能吃） */
function orbWbBound(key) {
    if (!key) return [];
    const list = orbWbBinds()[key];
    return Array.isArray(list) ? Array.from(new Set(list.filter(Boolean))) : [];
}
/** 整表替换某张卡的绑定（空数组＝解绑）*/
function orbWbSetBound(key, books) {
    if (!key) { toast('没认出来这张角色卡（拿不到头像文件名）', 'warning'); return false; }
    const b = orbWbBinds();
    const next = Array.from(new Set((books || []).filter(Boolean)));
    if (!next.length) delete b[key]; else b[key] = next;
    save();
    return true;
}
/** 加/减一本书（返回加完之后的清单）*/
function orbWbToggleBound(key, name) {
    const cur = orbWbBound(key).slice();
    const i = cur.indexOf(name);
    if (i >= 0) cur.splice(i, 1); else cur.push(name);
    orbWbSetBound(key, cur);
    return orbWbBound(key);
}
/** 反向查：谁绑了这本书（返回角色名数组）
    ⚠️ 「绑定」有两个来源，**两个都算**：
      ① 本扩展的绑定表 worldBinds（面板里点出来的）
      ② 角色卡自带的酒馆原生绑定 data.extensions.world（卡里写死的）
    只算 ① 的话，卡自带那本在自己那一行会显示"没有别的角色卡绑它" ——
    明明上面横幅刚说了"这张卡自带：XXX"，自相矛盾（用户反馈的就是这个）。
    ② 要遍历全部角色卡才能查出来：角色数 × 本书数 的量级（几十×几十），
    只在面板渲染时调，可接受。 */
function orbWbCharNames(name) {
    const n = String(name || '').trim();
    if (!n) return [];
    const b = orbWbBinds(), chars = orbCharList();
    const out = Object.keys(b)
        .filter(k => Array.isArray(b[k]) && b[k].indexOf(n) >= 0)
        .map(k => (chars.find(c => orbWbCharKey(c.id) === k) || {}).name || k);
    /* ② 卡自带的那本：遍历所有卡，谁的 extensions.world 是这本书就算谁 */
    let raw = [];
    try { raw = (getContext() || {}).characters || []; } catch (e) { raw = []; }
    raw.forEach(c => {
        if (!c || !c.name) return;
        let w = (c.data && c.data.extensions) ? c.data.extensions.world : '';
        /* ⚠️ extensions.world 正常情况下是字符串，但**可能是数组**（多本）——
           数组时要逐个比，不能只取 [0] 全等，否则会漏（自己踩过）。 */
        const ws = Array.isArray(w) ? w : [w];
        const hit = ws.some(x => String(x || '').trim() === n);
        if (hit && out.indexOf(c.name) < 0) out.push(c.name);
    });
    return out;
}
/** 这本书有没有绑在任何一张卡上 */
function orbWbIsBound(name) { return orbWbCharNames(name).length > 0; }

/* ===== 世界书分类（文件夹）—— 只存在本扩展设置里，不碰酒馆自己的世界书 =====
   模型：s.worldCats = { 分类名: [世界书名…] }，一本书**最多归一个分类**（用户要的是"文件夹"）。
   没有归类的书 = 未分类（不写进表里）。 */
function orbWbCats() {
    const s = getSettings();
    if (!s.worldCats || typeof s.worldCats !== 'object' || Array.isArray(s.worldCats)) s.worldCats = {};
    return s.worldCats;
}
/** 分类名列表（按名字排序，只保留非空的） */
function orbWbCatNames() {
    const c = orbWbCats();
    return Object.keys(c).filter(k => String(k || '').trim()).sort((a, b) => a.localeCompare(b, 'zh'));
}
/** 这本书属于哪个分类（'' = 未分类） */
function orbWbCatOf(name) {
    const c = orbWbCats();
    const n = String(name || '');
    for (const k of Object.keys(c)) {
        if (Array.isArray(c[k]) && c[k].indexOf(n) >= 0) return k;
    }
    return '';
}
/** 某分类里有几本书（只有真的存在这书才算，避免删书后留幽灵） */
function orbWbCatCount(cat) {
    const c = orbWbCats();
    if (!cat) return orbWorldList().filter(n => !orbWbCatOf(n)).length;
    const list = Array.isArray(c[cat]) ? c[cat] : [];
    const all = orbWorldList();
    return list.filter(n => all.indexOf(n) >= 0).length;
}
/** 建一个分类；名重复就返回 false */
function orbWbCatAdd(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    const c = orbWbCats();
    if (c[n]) return false;
    c[n] = [];
    save();
    return true;
}
/** 删分类（只是解散文件夹，书本身不受影响） */
function orbWbCatDel(name) {
    const c = orbWbCats();
    if (!c[name]) return false;
    delete c[name];
    save();
    return true;
}
/** 改名（连带把里面的书挪过去） */
function orbWbCatRename(from, to) {
    const c = orbWbCats();
    const n = String(to || '').trim();
    if (!c[from] || !n) return false;
    if (n === from) return true;
    if (c[n]) return false;                    // 目标重名
    c[n] = c[from];
    delete c[from];
    if (orbWbCat === from) orbWbCat = n;       // 当前正看着这个分类就跟过去
    save();
    return true;
}
/** 把一本书放进某个分类；cat 传 '' = 移出分类（未分类）。
    ⚠️ 先从所有分类里摘掉，保证"一本书只在一个分类里"。 */
function orbWbCatSet(book, cat) {
    const n = String(book || '').trim();
    if (!n) return false;
    const c = orbWbCats();
    Object.keys(c).forEach(k => {
        if (Array.isArray(c[k])) c[k] = c[k].filter(x => x !== n);
    });
    const t = String(cat || '').trim();
    if (t) {
        if (!Array.isArray(c[t])) c[t] = [];
        c[t].push(n);
    }
    save();
    return true;
}

/* ===== 分类（文件夹）——世界书、番外共用同一套 UI 与交互 =====
   ⚠️ 两边的**存储结构不同**，所以增删改查各写各的，只共用「界面怎么画 / 怎么点」：
     · 世界书：s.worldCats = { 分类名: [世界书名…] }   ← 分类持有书（书最多在一个分类里）
     · 番外：  每条番外自己带 n.cat = '分类名'          ← 归到哪一类由记录自己记
   占位符：D=标签栏属性  T=切换属性  P=挑分类属性  S=设定属性  A=新建属性  E=管理属性  R=改名属性  X=解散属性 */

/** 画一排分类标签 + 管理面板 / 挑分类抽屉。cfg：
    { all, uncat, cats, active, counts, D,T,P,S,A,E,R,X, edit, pick } */
function orbCatBarHTML(cfg) {
    const c = cfg || {};
    const at = (k, v) => k + '="' + esc(v) + '"';
    const n = (cat) => (c.counts && typeof c.counts[cat] === 'number') ? c.counts[cat] : null;
    /* kind：'notes' = 番外的分类。让标签栏自己带身份，点击时不用猜"现在在哪一页"。 */
    const kind = c.kind ? ' data-orb-catkind="' + esc(c.kind) + '"' : '';
    const tab = (val, label, cnt) => '<span class="ssp-wb-cat' + (c.active === val ? ' on' : '') + '"'
        + ' ' + at(c.D, val) + kind + ' title="只看这一类">' + esc(label)
        + (cnt !== null ? '<i>' + cnt + '</i>' : '') + '</span>';
    const list = Array.isArray(c.cats) ? c.cats : [];
    return '<div class="ssp-orb-catbar">'
        + tab(ORB_CAT_ALL, c.all || '全部', n(ORB_CAT_ALL))
        + tab('', c.uncat || '未分类', n(''))
        + list.map(x => tab(x, x, n(x))).join('')
        + '<span class="ssp-wb-cat ssp-wb-catadd" ' + at(c.A, '1') + kind + ' title="新建一个分类（文件夹）"><i class="fa-solid fa-folder-plus"></i></span>'
        + (list.length ? '<span class="ssp-wb-cat ssp-wb-catedit" ' + at(c.E, '1') + kind + ' title="管理分类（改名 / 解散）"><i class="fa-solid fa-pen"></i></span>' : '')
        + '</div>'
        + (c.edit && list.length
            ? '<div class="ssp-orb-catedit">' + list.map(x => '<div class="ssp-orb-catedit-r">'
                + '<input class="ssp-inp" type="text" ' + at(c.R, x) + ' value="' + esc(x) + '">'
                + '<span class="ssp-pbtn danger" ' + at(c.X, x) + ' title="解散这个分类（里面的东西不会丢）"><i class="fa-solid fa-trash"></i></span>'
                + '</div>').join('')
                + '<div class="ssp-orb-pcount" style="padding:2px 0 0">改名后按回车（或点别处）生效；解散分类只是去掉文件夹，内容本身不动。</div></div>'
            : '');
}

/** 某一行的「挑分类」抽屉。cfg：{ book, cats, cur, P,S, kind, newLabel } */
function orbCatPickHTML(cfg) {
    const c = cfg || {};
    const at = (k, v) => k + '="' + esc(v) + '"';
    const list = Array.isArray(c.cats) ? c.cats : [];
    /* kind：'notes' = 番外的分类（可选）。让 DOM 自己带身份，
       点击时不用去猜"现在在哪一页"（自测里 orbTab 可能跟真实页面不同步）。 */
    const kind = c.kind ? ' data-orb-catkind="' + esc(c.kind) + '"' : '';
    return '<div class="ssp-orb-catpick">'
        + '<!-- catpick -->'
        + '<span class="ssp-pbtn' + (!c.cur ? ' primary' : '') + '" ' + at(c.S, c.book) + kind + ' data-cat="">未分类</span>'
        + list.map(x => '<span class="ssp-pbtn' + (c.cur === x ? ' primary' : '') + '" ' + at(c.S, c.book) + kind + ' data-cat="' + esc(x) + '">' + esc(x) + '</span>').join('')
        /* ⚠️ 这个「新建分类并归入」**不能再挂 at(c.P, …)**：
           那样它同时带 data-orb-catpick="<书>" 和 data-orb-catpicknew="1"，
           而处理器先判 catpick → 每次点它都被当成"切换挑分类抽屉"，
           输入框永远展不开（用户反馈"点不开"）。只留 catpicknew，并带上"给谁归"。 */
        + '<span class="ssp-pbtn" data-orb-catpicknew="' + esc(c.book) + '"' + kind + '>'
        + '<i class="fa-solid fa-plus"></i>' + esc(c.newLabel || '新建分类并归入') + '</span>'
        + '<span class="ssp-pbtn" data-orb-catclose="1">收起</span>'
        + '</div>';
}
/** 「新建分类」抽屉（在某本书 / 某条番外上新建，并顺手把当前这条归进去）。cfg：{ at, P, hint, kind } */
function orbCatNewHTML(cfg) {
    const c = cfg || {};
    const kind = c.kind ? ' data-orb-catkind="' + esc(c.kind) + '"' : '';
    return '<div class="ssp-orb-catpick">'
        + '<input class="ssp-inp ssp-catnewin" type="text" ' + kind + ' data-orb-catnewfor="' + esc(c.at) + '" placeholder="' + esc(c.hint || '新分类叫什么…') + '">'
        + '<span class="ssp-pbtn primary" ' + kind + ' data-orb-catnewgo="1">建好并归入</span>'
        + '<span class="ssp-pbtn" data-orb-catnewcancel="1">取消</span>'
        + '</div>';
}
/** 问一段文字，promise 版（走酒馆的输入弹窗；拿不到就退回 window.prompt）。
    拿到空内容 / 弹窗不可用 → resolve(null)。新建美化用得上。 */
function orbAskText(title, def) {
    return new Promise(resolve => {
        const ctx = getContext() || {};
        const finish = (v) => { const n = String(v || '').trim(); resolve(n || null); };
        try {
            if (typeof ctx.callGenericPopup === 'function') {
                ctx.callGenericPopup(title, ctx.POPUP_TYPE.INPUT, def || '')
                    .then(r => finish(typeof r === 'string' ? r : '')).catch(() => resolve(null));
                return;
            }
        } catch (e) { }
        try { finish(globalThis.prompt ? globalThis.prompt(title, def || '') : ''); } catch (e) { resolve(null); }
    });
}

/** 点「＋」时问一个分类名（走酒馆的输入弹窗；拿不到就退回 prompt）。done(name) 拿到非空名才调用 */
function orbAskCatName(title, def, done) {
    const ctx = getContext() || {};
    const finish = (v) => { const n = String(v || '').trim(); if (n) done(n); };
    try {
        if (typeof ctx.callGenericPopup === 'function') {
            ctx.callGenericPopup(title, ctx.POPUP_TYPE.INPUT, def || '')
                .then(r => finish(typeof r === 'string' ? r : '')).catch(() => { });
            return true;
        }
    } catch (e) { }
    try { finish(globalThis.prompt ? globalThis.prompt(title, def || '') : ''); } catch (e) { }
    return true;
}

/** 世界书清单：优先上下文（st-context.js 的 getWorldInfoNames），退回酒馆的下拉框 */
function orbWorldList() {
    let names = [];
    try { names = (getContext() || {}).getWorldInfoNames?.() || []; } catch (e) { }
    if (!names.length) {
        const sel = document.getElementById('world_info');
        if (sel) names = Array.from(sel.options || []).map(o => (o.textContent || '').trim()).filter(Boolean);
    }
    if (names.length) orbWbNames = names.slice();
    return (names.length ? names : orbWbNames).slice();
}
/* ============================ 世界书栏 · 同步引擎 ============================
   ⚠️ 这一版把上一版的设计**简化掉了**。上一版允许"手动在聊天里启用某本"，
   于是生效列表里会留着**跟当前角色卡无关**的书，面板还得给它挂个「本聊天生效」标签 ——
   用户切卡后看到上一张卡点过的书还亮着「本聊天生效」，整个是脏的（实测反馈）。

   现在的模型（干净版）：
     · **绑定即生效**：一张卡绑定哪几本，本聊天就启用哪几本，一一对应
     · 面板上只有三种状态：生效中（已绑+已启用）／已绑·未启用（异常态）／没绑
       —— 不再有"本聊天生效但不属于这张卡"这种东西
     · 切卡时：把**本扩展为这张卡启用过的**书撤掉，再启用新卡绑定的那几本
       （只动扩展自己启用过的，用户手动勾的一本不碰；撤销后如果原状里有，会补回来）
     · 换聊天时重置记账：新聊天有自己的世界书状态，不继承上一个聊天的账
   ========================================================================== */

/** 本聊天真正生效的世界书（读酒馆自己那个多选框 #world_info） */
function orbWbActive() {
    const sel = document.getElementById('world_info');
    if (!sel) return [];
    return Array.from(sel.selectedOptions || []).map(o => (o.textContent || '').trim()).filter(Boolean);
}
/** 记账：本扩展在这个聊天里启用过哪几本（键＝聊天） */
function orbWbEnabled(key) {
    const r = orbWbRecord(key);
    return (r && Array.isArray(r.ext)) ? r.ext.filter(Boolean) : [];
}
/** 记一笔：谁在什么时候启用了哪几本 */
function orbWbEnabledSet(key, books) {
    const next = Array.from(new Set((books || []).filter(Boolean)));
    if (!next.length) { delete orbWbApplied()[key]; save(); return; }
    orbWbApplied()[key] = { ext: next, at: Date.now() };
    save();
}

/** 只在多选框上做增删（不记账）—— 内部用 */
function orbWbSelApply(add, del) {
    const sel = document.getElementById('world_info');
    if (!sel) return null;
    const wantAdd = (add || []).filter(Boolean);
    const wantDel = (del || []).filter(Boolean);
    if (!wantAdd.length && !wantDel.length) return { added: [], removed: [] };
    Array.from(sel.options || []).forEach(o => {
        const n = (o.textContent || '').trim();
        if (wantAdd.indexOf(n) >= 0) o.selected = true;
        if (wantDel.indexOf(n) >= 0) o.selected = false;
    });
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { added: wantAdd, removed: wantDel };
}

/** 把当前聊天的生效列表**对齐到这张角色卡的绑定**，并记账我们启用了哪些。
    返回 {added, removed} 或 null（拿不到多选框）。 */
function orbWbSyncChar() {
    if (!orbWbAuto()) return null;
    const sel = document.getElementById('world_info');
    if (!sel) { toast('拿不到酒馆的世界书选择框（#world_info），先刷新一下页面', 'warning'); return null; }
    const ch = orbWbCurChar();
    if (!ch) return null;
    const key = orbWbChatKey();
    const all = orbWorldList();
    const bound = orbWbBound(ch.key);
    const gone = bound.filter(n => all.indexOf(n) < 0);
    if (gone.length) toast('绑的世界书找不到了：' + gone.join('、'), 'warning');
    const want = bound.filter(n => all.indexOf(n) >= 0);

    let cur = orbWbActive();
    const enabled = orbWbEnabled(key);                                  // 本聊天键记过账的
    /* ⚠️ 撤的范围不能只看「本聊天键」：上一张卡的书可能记在**别的键**下 ——
       切角色那次 cleanup 一旦没跑到（事件时序、或从别处切过来的），
       那本书就永远撤不掉，表现得像"全局启用"（用户反馈过）。
       所以把我们**在任何聊天里启用过**的书都算进来：是"我们加的" + 这张卡没绑 → 撤。
       用户自己手动勾的从不进这本账，依旧一概不动。 */
    const ours = new Set(enabled);
    try { Object.keys(orbWbApplied()).forEach(k => orbWbEnabled(k).forEach(n => ours.add(n))); } catch (e) { }
    const del = cur.filter(n => ours.has(n) && want.indexOf(n) < 0);
    /* 该补的：这张卡绑了、但当前没生效的 */
    const add = want.filter(n => cur.indexOf(n) < 0);
    /* 记账：留下本键"我们启用过哪几本"（「还原这个聊天」要用），没变就不写 */
    const keepEnabled = enabled.filter(n => want.indexOf(n) >= 0);
    if (del.length || add.length) {
        const rec = orbWbRecord(key) || {};
        const prev = Array.isArray(rec.prev) ? rec.prev.slice() : cur.slice();
        const next = Array.from(new Set(keepEnabled.concat(add)));
        if (!next.length) { delete orbWbApplied()[key]; save(); }
        else { orbWbApplied()[key] = { ext: next, prev: prev, at: Date.now() }; save(); }
    }

    if (!del.length && !add.length) return { added: [], removed: [] };
    const r = orbWbSelApply(add, del);
    if (!r) return null;
    return { added: add, removed: del };
}
/** 旧名保留（面板/事件里都还在调）：等于 orbWbSyncChar */
function orbWbApplyForChar() {
    const r = orbWbSyncChar();
    return !!(r && (r.added.length || r.removed.length));
}

/** 撤销：把本扩展在这个聊天里启用过的书撤掉（用户手动勾的一本不碰），并删掉记账。
    kind='restore'（手动「还原这个聊天」按钮）：撤掉我们启用过的，并把同时被撤掉的原状补回来。
    kind='reset'  （切聊天/切角色）：只撤掉我们启用过的 + 删记账 ——
       新聊天有自己的世界书状态、由酒馆自己加载，不需要我们补回任何东西。 */
function orbWbCleanup(key, kind) {    const sel = document.getElementById('world_info');
    const enabled = orbWbEnabled(key);
    if (sel && enabled.length) {
        const cur = orbWbActive();
        const now = enabled.filter(n => cur.indexOf(n) >= 0);
        if (now.length) orbWbSelApply([], now);
        if (kind === 'restore') {
            /* 旧数据里可能存过 prev（用户原状）；撤掉之后把本该有的补回来 */
            const rec = orbWbRecord(key);
            const prev = (rec && Array.isArray(rec.prev)) ? rec.prev : [];
            const cur2 = orbWbActive();
            const back = prev.filter(n => cur2.indexOf(n) < 0 && now.indexOf(n) < 0);
            if (back.length) orbWbSelApply(back, []);
        }
    }
    if (key) { delete orbWbApplied()[key]; save(); }
    return true;
}

/* ============================ 条目层（世界书里的每一条）============================
   世界书是「一本一本」的，每本里有很多**条目**。酒馆原生只能去它的编辑器里逐条点开，
   很麻烦 —— 这里把条目直接摊到鼠鼠面板上：**看、开关、改、新建、删**。

   条目结构（读真书文件确认过）：
     整本 = { entries: { "0": {…}, "1": {…} } }     ← 键就是 uid（顺序数字）
     条目 = { uid, comment(标题), content(正文), key(触发词,逗号分隔),
              constant(常驻), vectorized(向量化), disable(禁用), displayIndex, order, depth,
              position, probability, … }

   酒馆自己那套「状态」图标（原文见 public/index.html 的 entryStateSelector）：
      🔵 constant（常驻，一直在提示词里） / 🟢 normal（关键词触发） / 🔗 vectorized / ❌ disabled
   本扩展照抄这套语义，所以面板上的点和酒馆编辑器里看到的一致。

   ⚠️ 落盘规矩：只改我们碰的那几个字段，然后整份 data 交给 saveWorldInfo。
   loadWorldInfo 返回的对象就是酒馆缓存里的同一份引用，所以改完存回是安全的；
   但**每次要用都重新 load**，不要缓存整本（免得覆盖掉用户在酒馆编辑器里的手改）。
   ========================================================================== */

/** 条目状态 → 酒馆那套图标 */
function orbEntryIcon(e) {
    if (!e || e.disable) return '❌';
    if (e.constant === true) return '🔵';
    if (e.vectorized === true) return '🔗';
    return '🟢';
}
/** 状态的人话说明（面板上用） */
function orbEntryStateText(e) {
    if (!e || e.disable) return '已关闭';
    if (e.constant === true) return '常驻';
    if (e.vectorized === true) return '向量化';
    return '关键词触发';
}
/** 关键词触发时，把触发词显示出来（截断） */
function orbEntryKeys(e) {
    const k = e && e.key;
    if (Array.isArray(k)) return k.filter(Boolean).join('、');
    return String(k || '').trim();
}
/** 正文字数（粗略，给人看个量级） */
function orbEntryLen(e) {
    return String((e && e.content) || '').replace(/\s+/g, '').length;
}
/** 这本世界书里有哪些条目（按 displayIndex/uid 排好） */
async function orbEntriesOf(book) {
    const name = String(book || '').trim();
    if (!name) return [];
    let data = null;
    try {
        const load = (getContext() || {}).loadWorldInfo;
        if (typeof load === 'function') data = await load(name);
    } catch (e) { }
    if (!data) {
        /* 退路：直接读文件（酒馆的 /api/worldinfo/get） */
        try {
            const r = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, (getContext() || {}).getRequestHeaders?.() || {}),
                body: JSON.stringify({ name }),
            });
            if (r.ok) data = await r.json();
        } catch (e) { }
    }
    const ents = (data && data.entries) || {};
    const out = Object.keys(ents).map(k => ents[k]).filter(Boolean);
    out.sort((a, b) => {
        const da = Number(a.displayIndex), db = Number(b.displayIndex);
        if (isFinite(da) && isFinite(db) && da !== db) return da - db;
        return (Number(a.uid) || 0) - (Number(b.uid) || 0);
    });
    return out;
}

/** 造一个酒馆认的条目对象（真书的形状）。新建单条 / 批量写入 / 预置示例都走它。 */
function orbMakeEntry(uid, f) {
    const o = f || {};
    return {
        uid,
        key: Array.isArray(o.key) ? o.key.filter(Boolean) : String(o.key || '').split(',').map(s => s.trim()).filter(Boolean),
        keysecondary: [],
        comment: String(o.comment || '').trim() || ('新条目 ' + uid),
        content: String(o.content || ''),
        constant: o.constant !== false,
        vectorized: false,
        selective: true,
        selectiveLogic: 0,
        addMemo: true,
        order: 100,
        position: 0,
        disable: false,
        displayIndex: uid,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        probability: 100,
        useProbability: true,
        depth: 4,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: 0,
        sticky: 0,
        cooldown: 0,
        delay: 0,
    };
}

/** 在指定书里新建一个条目。默认 🔵 常驻（用户要的"补一段世界观"路径最短）。
    fields 可给 comment / content / key / constant。返回新条目或 null。 */
async function orbEntryAdd(book, fields) {
    const name = String(book || '').trim();
    if (!name) { toast('没指定世界书', 'warning'); return null; }
    const ctx = getContext() || {};
    const f = fields || {};
    try {
        const data = await ctx.loadWorldInfo?.(name);
        if (!data) { toast('读不到世界书「' + name + '」', 'warning'); return null; }
        if (!data.entries || typeof data.entries !== 'object') data.entries = {};
        /* 下一个空 uid：从 0 往上找第一个没被占的 */
        let uid = 0;
        while (data.entries[uid] !== undefined) uid += 1;
        const entry = orbMakeEntry(uid, f);
        data.entries[uid] = entry;
        await ctx.saveWorldInfo?.(name, data);
        return entry;
    } catch (e) {
        toast('新建条目失败：' + (e && e.message), 'warning');
        return null;
    }
}

/** 改一个条目。patch 里给什么改什么（comment / content / key / constant / vectorized /
    disable / order / depth / position / probability）。返回 true/false。 */
async function orbEntrySave(book, uid, patch) {
    const name = String(book || '').trim();
    const ctx = getContext() || {};
    const want = patch || {};
    try {
        const data = await ctx.loadWorldInfo?.(name);
        if (!data || !data.entries || !data.entries[uid]) { toast('找不到这个条目', 'warning'); return false; }
        const e = data.entries[uid];
        if ('comment' in want) e.comment = String(want.comment || '');
        if ('content' in want) e.content = String(want.content || '');
        if ('key' in want) e.key = String(want.key || '').split(',').map(s => s.trim()).filter(Boolean);
        if ('constant' in want) {
            e.constant = Boolean(want.constant);
            if (e.constant) e.vectorized = false;         // 和酒馆一样：常驻与向量化互斥
        }
        if ('vectorized' in want) {
            e.vectorized = Boolean(want.vectorized);
            if (e.vectorized) e.constant = false;
        }
        if ('disable' in want) e.disable = Boolean(want.disable);
        ['order', 'depth', 'position', 'probability'].forEach(k => {
            if (k in want) {
                const n = Number(want[k]);
                if (isFinite(n)) e[k] = n;
            }
        });
        await ctx.saveWorldInfo?.(name, data);
        return true;
    } catch (err) {
        toast('保存条目失败：' + (err && err.message), 'warning');
        return false;
    }
}

/** 开关一个条目（只翻 disable）。返回新状态（true=开着）。 */
async function orbEntryToggle(book, uid) {
    const name = String(book || '').trim();
    const ctx = getContext() || {};
    try {
        const data = await ctx.loadWorldInfo?.(name);
        if (!data || !data.entries || !data.entries[uid]) { toast('找不到这个条目', 'warning'); return null; }
        const on = data.entries[uid].disable === true;   // 原来是关的 → 打开
        data.entries[uid].disable = !on;
        await ctx.saveWorldInfo?.(name, data);
        return on;
    } catch (e) {
        toast('开关条目失败：' + (e && e.message), 'warning');
        return null;
    }
}

/** 删一个条目（面板里做二次确认才调它） */
async function orbEntryDel(book, uid) {
    const name = String(book || '').trim();
    const ctx = getContext() || {};
    try {
        const data = await ctx.loadWorldInfo?.(name);
        if (!data || !data.entries || !data.entries[uid]) { toast('找不到这个条目', 'warning'); return false; }
        delete data.entries[uid];
        await ctx.saveWorldInfo?.(name, data);
        return true;
    } catch (e) {
        toast('删除条目失败：' + (e && e.message), 'warning');
        return false;
    }
}

/** 一次删多条（DLC 栏「清空全部条目」用）。
    读一次 → 删一批 → 存一次，比逐条 load/save 快得多，也不会互相覆盖。返回真删掉的条数。 */
async function orbEntryDelMany(book, uids) {
    const name = String(book || '').trim();
    const list = Array.isArray(uids) ? uids : [];
    if (!name || !list.length) return 0;
    const ctx = getContext() || {};
    try {
        const data = await ctx.loadWorldInfo?.(name);
        if (!data || !data.entries) { toast('读不到这本书', 'warning'); return 0; }
        let n = 0;
        list.forEach(uid => {
            if (data.entries[uid] !== undefined) { delete data.entries[uid]; n++; }
        });
        if (!n) return 0;
        await ctx.saveWorldInfo?.(name, data);
        return n;
    } catch (e) {
        toast('清空失败：' + (e && e.message), 'warning');
        return 0;
    }
}

/* ============================ DLC 首次预置的示例条目 ============================
   用户问"导入扩展能不能自动生成" —— 结论：**装完那一刻不会**（酒馆的扩展安装只 clone + 校验
   manifest，manifest 里也没有安装脚本字段），是**第一次打开 DLC 标签页时创建**。
   这里让那份"第一次"更有用：书不存在时顺手写几条示例进去，让人一眼看懂
   🔵 常驻 / 🟢 关键词触发 的区别，也是"补世界观"的模板。文案故意写成示例口吻。 */
const DLC_SEED = [
    {
        comment: '示例·世界观基调（常驻）',
        content: '【世界观基调】时代与地点由你自己改：这里写这个世界的底色 —— 社会形态、技术水平、有没有异能/魔法、以及最重要的「什么是不允许的」（比如没有复活、没有跨世界电话）。'
            + '\n常驻条目的特点：不管聊到什么都会被塞进提示词。所以它适合放"始终成立"的设定，篇幅别太长。',
        constant: true,
    },
    {
        comment: '示例·地点（说到才触发）',
        content: '【地点：旧城区】老城区的路面是磨光的青石，一下雨就泛着光。街角有家二十四小时不关门的便利店，店主从不多问。晚上十点以后，主街的灯会一盏一盏地灭，只有便利店那块招牌还亮着。',
        constant: false,
        key: ['旧城区', '老城区', '青石'],
    },
    {
        comment: '示例·人物（说到才触发）',
        content: '【人物：陈叔】便利店的店主，五十来岁，右手小指少半截。话少，只在结账时说一句"慢走"。他记得每个熟客买什么，但从不多问——这街区的人都信他这一点。',
        constant: false,
        key: ['陈叔', '店主', '便利店'],
    },
];
/** 这本书现在有没有条目（用来判断"是不是全新的书"） */
async function orbEntriesCount(book) {
    try { return (await orbEntriesOf(book)).length; } catch (e) { return -1; }
}
/** 一次性写入多条条目（首次预置 / 「装一份示例」按钮都用它；只 load 一次、save 一次） */
async function orbEntryAddMany(book, items) {
    const name = String(book || '').trim();
    const list = Array.isArray(items) ? items : [];
    if (!name || !list.length) return 0;
    const ctx = getContext() || {};
    try {
        const data = await ctx.loadWorldInfo?.(name);
        if (!data) { toast('读不到世界书「' + name + '」', 'warning'); return 0; }
        if (!data.entries || typeof data.entries !== 'object') data.entries = {};
        let uid = 0;
        let n = 0;
        list.forEach(it => {
            while (data.entries[uid] !== undefined) uid += 1;      // 往上找空位
            data.entries[uid] = orbMakeEntry(uid, it);
            uid += 1; n += 1;
        });
        await ctx.saveWorldInfo?.(name, data);
        return n;
    } catch (e) {
        toast('写入示例条目失败：' + (e && e.message), 'warning');
        return 0;
    }
}
/** 首次打开 DLC：书**不存在**时才建 + 预置示例；书已存在（哪怕空的）一概不动。 */
async function orbDlcFirstRun() {
    const name = orbDlcBook();
    if (orbWorldList().indexOf(name) >= 0) return false;          // 已经有了 → 尊重现状（包括被你清空）
    const ok = await orbDlcEnsureBook();                          // 不存在 → 建一本空的
    if (!ok) return false;
    const n = await orbEntryAddMany(name, DLC_SEED);
    if (n) toast('已为你建好「' + name + '」并放了 ' + n + ' 条示例，照着改就行', 'success');
    return true;
}
/** 「装一份示例」按钮：不管书什么状态，都追加一份模板 */
async function orbDlcAddSeed() {
    await orbDlcEnsureBook();
    const n = await orbEntryAddMany(orbDlcBook(), DLC_SEED);
    if (n) toast('已追加 ' + n + ' 条示例条目', 'success');
    return n;
}

/** DLC 那本书名（可配，默认「鼠鼠DLC」） */
function orbDlcBook() {
    const s = getSettings();
    if (typeof s.dlcBook !== 'string' || !s.dlcBook.trim()) s.dlcBook = '鼠鼠DLC';
    return s.dlcBook.trim();
}
/** 新建条目默认是不是常驻（用户可切；默认是） */
function orbDlcConstantDefault() {
    const s = getSettings();
    if (typeof s.dlcConstant !== 'boolean') s.dlcConstant = true;
    return s.dlcConstant;
}
/** DLC 那本书存在吗（不存在就建一本空的，走酒馆自己的接口，这样酒馆也认） */
var orbDlcEnsuring = false;
async function orbDlcEnsureBook() {
    const name = orbDlcBook();
    const all = orbWorldList();
    if (all.indexOf(name) >= 0) return true;
    if (orbDlcEnsuring) return false;
    orbDlcEnsuring = true;
    try {
        /* 酒馆没有导出「新建世界书」的接口给扩展，所以直接写文件：
           /api/worldinfo/edit 就是酒馆自己保存世界书用的那个端点。 */
        const body = { name, data: { entries: {} } };
        const r = await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, (getContext() || {}).getRequestHeaders?.() || {}),
            body: JSON.stringify(body),
        });
        if (!r.ok) { toast('建不了「' + name + '」这本书（HTTP ' + r.status + '）', 'warning'); return false; }
        try { await (getContext() || {}).updateWorldInfoList?.(); } catch (e) { }
        orbWorldList();
        return true;
    } catch (e) {
        toast('建不了「' + name + '」：' + (e && e.message), 'warning');
        return false;
    } finally {
        orbDlcEnsuring = false;
    }
}

/* ============================ DLC 栏（鼠鼠口袋内置的一本世界书）============================
   用户要的：一本**专门放这类条目**的书，打开就能改、就能开关 —— 相当于鼠鼠口袋内置了一本
   世界书。默认常驻（🔵），补一段世界观不用填触发词。

   - 书是**真世界书文件**（默认叫「鼠鼠DLC」）→ 酒馆也能认、也能参与扫描，两边是同一份
   - 书**不存在**时：建一本，并顺手写几条示例（首次预置，见 DLC_SEED）；
     书已存在（哪怕被你清空）一概不动 —— 尊重你的现状
   - 条目行的「点」和「行样式」跟世界书栏**共用同一套**（orbEntryRowHTML / orbEntryFormHTML）
   ========================================================================== */
var orbDlcEntries = [];      // 缓存：当前书的条目
var orbDlcLoaded = false;    // 这次打开有没有拉到过
var orbDlcOpen = null;       // uid 或 'new'（正在展开编辑的那条）
var orbDlcDraft = null;      // 新建时的草稿（切页回来还在）
var orbDlcErr = '';

/** 拉一次条目（异步，回来重画） */
async function orbDlcFetch() {
    orbDlcErr = '';
    try {
        /* 首次：书不存在才建 + 预置示例；已存在就直接用 */
        await orbDlcFirstRun();
        const list = await orbEntriesOf(orbDlcBook());
        orbDlcEntries = list;
        orbDlcLoaded = true;
        /* v1.31.59：①清掉"条目已经不在了"的孤儿绑定 ②把「全局常驻」对齐 ③挂上面具监听 */
        try {
            const n = dlcMaskPrune(list);
            if (n) toast('清理了 ' + n + ' 条失效的面具绑定（原来那条条目已经不在书里了）', 'info');
        } catch (e) { }
        try { if (dlcGlobalOn()) dlcGlobalApply(true); } catch (e) { }
        try { bindDlcMaskWatch(); } catch (e) { }
    } catch (e) {
        orbDlcErr = String((e && e.message) || e);
        orbDlcLoaded = true;
    }
    if (orbOpenNow && orbTab === 'dlc') renderOrbPanel();
}
/** 打开这一页时按需拉（书换了也重拉） */
var orbDlcLoadedBook = '';
function orbDlcEnsure() {
    const book = orbDlcBook();
    bindWbWatch();                            // 进 DLC 页也重试一次
    if (orbDlcLoaded && orbDlcLoadedBook === book) return;
    orbDlcLoadedBook = book;
    orbDlcLoaded = false;
    setTimeout(() => { orbDlcFetch(); }, 0);
}

function orbDlcRowsHTML() {
    return orbEntryListHTML({
        entries: orbDlcEntries, book: orbDlcBook(), editing: orbDlcOpen,
        kind: 'dlc', search: orbDlcSearch, loaded: orbDlcLoaded, err: orbDlcErr,
    });
}

function orbDlcHTML() {
    /* 正在给某一条挑面具 → 整页换成挑面具的界面（跟面具页那套「绑定角色」一个套路） */
    if (orbDlcMaskFor !== null && orbDlcMaskFor !== undefined) return dlcMaskPickerHTML(orbDlcMaskFor);
    const book = orbDlcBook();
    const on = orbDlcEntries.filter(e => e.disable !== true).length;
    const worn = dlcWornPersona();
    const boundN = orbDlcEntries.filter(e => dlcEntryMasks(e.uid).length > 0).length;
    const idleN = orbDlcEntries.filter(e => dlcEntryMasks(e.uid).length > 0 && !dlcEntryEffective(e)).length;
    /* 三个筛选（全部 / 只给面具的 / 没绑的） */
    const filterBar = '<div class="ssp-orb-pcount ssp-en-maskfilters">'
        + [['all', '全部 ' + orbDlcEntries.length], ['mask', '只给面具的 ' + boundN], ['free', '没绑的 ' + (orbDlcEntries.length - boundN)]]
            .map(([k, label]) => '<span class="ssp-pbtn' + (orbDlcFilter === k ? ' primary' : '') + '" data-orb-dlcfilter="' + k + '">' + label + '</span>').join('')
        + '</div>';
    /* 「全局常驻」：书不常在，条目开了也不生效（用户要求 DLC 这本书保持全局生效） */
    const gsel = dlcGlobalSelected();
    const globalRow = '<label class="ssp-orb-auto" style="padding-top:4px"><input type="checkbox" data-orb-dlcglobal="1"'
        + (dlcGlobalOn() ? ' checked' : '') + '><span>让「' + esc(book) + '」全局常驻'
        + (gsel === null ? '（还没读到酒馆的世界书面板）' : (gsel ? '（已勾上）' : '（还没勾上）')) + '</span></label>'
        + (gsel === null
            ? '<div class="ssp-orb-empty" style="padding:0 2px 4px">先在酒馆里打开一次「世界书」面板，这里就能自动帮你勾上它。</div>'
            : '');
    const bar = '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-dlcsearch="1" placeholder="搜条目（标题 / 正文 / 触发词）" value="' + esc(orbDlcSearch) + '">'
        + (orbDlcSearch ? '<span class="ssp-pbtn" data-orb-dlcclear="1">清除</span>' : '')
        + '</div>';
    const tools = '<div class="ssp-orb-pcount">'
        + '<span class="ssp-pbtn primary" data-orb-dlcnew="1"><i class="fa-solid fa-plus"></i>新建条目</span>'
        + '<span class="ssp-pbtn" data-orb-dlcrefresh="1"><i class="fa-solid fa-rotate"></i>刷新</span>'
        + '<span class="ssp-pbtn" data-orb-dlcseed="1" title="追加几条示例条目（常驻 / 关键词触发各一条，照着改）">'
        + '<i class="fa-solid fa-wand-magic-sparkles"></i>装一份示例</span>'
        /* 一条条点太累（用户"创建了一大堆删不掉"）→ 给个一键清空，但要过一道确认 */
        + (orbDlcEntries.length
            ? '<span class="ssp-pbtn danger" data-orb-dlcpurge="1" title="把这本书的条目全删掉（会先问一次）">'
                + '<i class="fa-solid fa-eraser"></i>清空全部条目</span>'
            : '')
        + '</div>'
        + (orbPurgeConfirm
            ? '<div class="ssp-en-confirm">'
                + '<span class="ssp-en-confirm-t">把「' + esc(book) + '」里 <b>' + orbDlcEntries.length + '</b> 条全删掉？</span>'
                + '<span class="ssp-pbtn danger" data-orb-dlcpurgego="1"><i class="fa-solid fa-trash"></i>确认清空</span>'
                + '<span class="ssp-pbtn" data-orb-dlcpurgecancel="1">算了</span>'
                + '</div>'
            : '');
    const info = '<div class="ssp-orb-empty" style="padding-top:2px">'
        + '这本书：<b>' + esc(book) + '</b> · 共 <b>' + orbDlcEntries.length + '</b> 条，'
        + '其中 <b>' + on + '</b> 条你自己的开关是开的' + (boundN ? '，<b>' + boundN + '</b> 条绑了面具' : '') + '<br>'
        + (boundN
            ? '现在戴着：<b>' + (worn ? esc(dlcPersonaName(worn)) : '（没戴面具）') + '</b>'
                + ' · 绑了面具的条目里 <b>' + idleN + '</b> 条现在不生效'
                + (worn ? '（戴着别的面具的那些 —— 专属，换走就关）' : '（没戴面具时按它们自己的开关走）') + '<br>'
            : '')
        + '<span style="opacity:.7">🔵常驻 🟢关键词触发 🔗向量化 ❌已关闭 —— 点那一行就是开关。'
        + '点 🎭 给这条绑面具：<b>戴上那个面具就自动开</b>（生成时生效，不改你的书文件）。</span>'
        + '</div>';
    const draft = (orbDlcOpen === 'new')
        ? orbEntryFormHTML(null, book, true, orbDlcDraft || { comment: '', content: '', key: '', constant: orbDlcConstantDefault() })
        : '';
    const keyNote = '<label class="ssp-orb-auto" style="padding-top:4px"><input type="checkbox" data-orb-dlcconst="1"'
        + (orbDlcConstantDefault() ? ' checked' : '') + '><span>新建时默认用 🔵 常驻</span></label>';
    return bar + filterBar + tools + globalRow + info + keyNote + draft
        + '<div id="ssp_orb_dlc_list">' + orbDlcRowsHTML() + '</div>';
}
/* ============================ DLC 条目 ↔ 面具 绑定（v1.31.59）============================
   用户要的（讨论过好几轮，最后定的）：开始玩一张角色卡时必定会选一款面具 —— 选了面具之后，
   **把属于这个面具的 DLC 条目打开**，其余条目一律不插手；没绑面具的条目照旧走自己的开关。
   一句话：**绑定 = "玩这个面具时必须有它"**。

   规则（用户逐条拍板）：
     · 没绑面具              → 完全按它自己的开关，面具不插手
     · 绑了 + 正戴着名单里的   → 强制开（你手动"临时关"的除外）
     · 绑了 + 正戴着别的面具   → 关（专属：换走就关）
     · 绑了 + 没戴面具        → 按它自己的开关（宽松；用户把这条从"严格"改成了"宽松"）

   实现（**绝不改你的书文件**，用户选的"甲"，他在对话里确认过这个语义）：
     · 酒馆每次生成前发 WORLDINFO_ENTRIES_LOADED，交出来的条目对象是**克隆**
       （world-info.js:4445/4492：`{uid, world: 书名, ...rest}`），我就在那一刻把该关的标成
       disable=true、该开的标成 disable=false —— **只影响这一次提示词**。
     · 所以 鼠鼠DLC.json 一字不动：酒馆自己的世界书编辑器里它仍显示"未启用"，
       但生成时它确实进了提示词。扩展没加载/被关掉 → 回到书里的原样（等于没绑过）。
     · 没绑面具的条目**永远不碰**。
   ========================================================================== */

/** 绑定表：s.dlcEntryMasks[书名][条目uid] = [面具id…]（按书名分开：uid 只在书内唯一） */
function dlcMaskBookTable(book) {
    const s = getSettings();
    if (!s.dlcEntryMasks || typeof s.dlcEntryMasks !== 'object' || Array.isArray(s.dlcEntryMasks)) s.dlcEntryMasks = {};
    const key = String(book || '').trim();
    if (!key) return {};
    if (!s.dlcEntryMasks[key] || typeof s.dlcEntryMasks[key] !== 'object' || Array.isArray(s.dlcEntryMasks[key])) s.dlcEntryMasks[key] = {};
    return s.dlcEntryMasks[key];
}
function dlcMaskTable() { return dlcMaskBookTable(orbDlcBook()); }

/** 一个条目绑了哪些面具（永远返回新数组） */
function dlcEntryMasks(uid) {
    const v = dlcMaskTable()[String(uid)];
    return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
}
/** 绑 / 解绑一个面具（返回 true = 现在绑上了） */
function dlcMaskToggle(uid, pid, book) {
    const t = dlcMaskBookTable(book || orbDlcBook());
    const k = String(uid);
    if (!Array.isArray(t[k])) t[k] = [];
    const i = t[k].indexOf(pid);
    if (i >= 0) t[k].splice(i, 1); else if (pid) t[k].push(pid);
    if (!t[k].length) delete t[k];                 // 空数组不留（少点垃圾数据）
    save();
    return i < 0;
}
function dlcMaskClear(uid, book) {
    const t = dlcMaskBookTable(book || orbDlcBook());
    delete t[String(uid)];
    save();
    return true;
}
/** 清理孤儿绑定：条目已经不在书里了 → 绑定也删掉（返回清了几条） */
function dlcMaskPrune(entries) {
    const t = dlcMaskTable();
    const live = new Set((entries || []).map(e => String(e.uid)));
    let n = 0;
    Object.keys(t).forEach(uid => { if (!live.has(String(uid))) { delete t[uid]; n++; } });
    if (n) save();
    return n;
}
/** 某个面具挂着几条 DLC 条目（面具页只读展示用） */
function dlcPersonaEntryCount(pid) {
    let n = 0;
    Object.keys(dlcMaskTable()).forEach(uid => { if (dlcEntryMasks(uid).indexOf(pid) >= 0) n++; });
    return n;
}
/** 条目绑的面具名字（逗号分隔）；没绑返回空串 */
function dlcMaskNames(uid) {
    const list = dlcEntryMasks(uid);
    if (!list.length) return '';
    const all = orbPersonas();
    return list.map(id => (all.find(p => p.id === id) || {}).name || id).join('、');
}
/** 面具 id → 名字（读不到就回 id） */
function dlcPersonaName(id) {
    const all = orbPersonas();
    return (all.find(p => p.id === id) || {}).name || String(id || '');
}
/** 现在戴的是哪个面具 —— **按酒馆自己的顺序读数据**，都读不到才退回 DOM：
    chat_metadata.persona（本聊天锁定的）→ 事件里记下的 → 酒馆列表里 .selected 那个
    → 名字对得上唯一一个面具。都没有 = 空串（没戴面具）。 */
function dlcWornPersona() {
    try {
        /* e2e 用：只在 __SSP_TEST__ 打开时生效（测试要能模拟"没戴面具 / 戴着某个面具"） */
        if (globalThis.__SSP_TEST__ && globalThis.__SSP_TEST_PERSONA__ !== undefined) {
            return String(globalThis.__SSP_TEST_PERSONA__ || '');
        }
        const ctx = getContext() || {};
        const md = ctx.chatMetadata || {};
        if (typeof md.persona === 'string' && md.persona) return md.persona;
        if (dlcWornCache) return dlcWornCache;
        const dom = orbActivePersona();
        if (dom) return dom;
        const pu = ctx.powerUserSettings || {};
        const nm = String(ctx.name1 || '');
        if (nm) {
            const hit = Object.keys(pu.personas || {}).filter(k => String((pu.personas || {})[k]) === nm);
            if (hit.length === 1) return hit[0];
        }
    } catch (e) { }
    return '';
}
/** 这一条现在什么状态（UI 显示 + 判断都用它）：
    mode = free（没绑·按自己开关）/ on（跟着面具开着）/ temp-off（你临时关了）/
           other-mask（戴着别的面具 → 关）/ no-mask（没戴面具 → 按自己开关） */
function dlcEntryState(e) {
    const bound = dlcEntryMasks(e && e.uid);
    const worn = dlcWornPersona();
    const own = !(e && e.disable === true);
    if (!bound.length) return { bound: bound, worn: worn, mode: 'free', effective: own };
    if (!worn) return { bound: bound, worn: '', mode: 'no-mask', effective: own };
    if (bound.indexOf(worn) < 0) return { bound: bound, worn: worn, mode: 'other-mask', effective: false };
    if (dlcTempOff.has(String(e && e.uid))) return { bound: bound, worn: worn, mode: 'temp-off', effective: false };
    return { bound: bound, worn: worn, mode: 'on', effective: true };
}
function dlcEntryEffective(e) { return dlcEntryState(e).effective; }

/** 生成前的那一发过滤（**只在内存里改，书文件不动**）。返回被动过的条数。 */
function dlcFilterEntries(payload) {
    const p = payload || {};
    const book = orbDlcBook();
    const worn = dlcWornPersona();
    const groups = [p.globalLore, p.characterLore, p.chatLore, p.personaLore];
    let n = 0;
    groups.forEach(arr => {
        if (!Array.isArray(arr)) return;
        arr.forEach(e => {
            if (!e || String(e.world || '') !== book) return;    // 只管 DLC 这一本
            const bound = dlcEntryMasks(e.uid);
            if (!bound.length) return;                           // 没绑面具 → 永远不插手
            if (!worn) return;                                   // 没戴面具 → 宽松：按它自己的开关
            const want = (bound.indexOf(worn) >= 0) ? !dlcTempOff.has(String(e.uid)) : false;
            if (want && e.disable === true) { e.disable = false; n++; }
            else if (!want && e.disable !== true) { e.disable = true; n++; }
        });
    });
    return n;
}
/** 挂监听（幂等）：①生成前过滤 ②换面具/换聊天时刷新面板上的标记 */
function bindDlcMaskWatch() {
    if (bindDlcMaskWatch.done) return true;
    try {
        const c = getContext() || {};
        const es = c.eventSource, et = c.eventTypes || {};
        if (!es || typeof es.on !== 'function') return false;
        es.on(et.WORLDINFO_ENTRIES_LOADED || 'worldinfo_entries_loaded', (payload) => {
            try { dlcFilterEntries(payload); } catch (e) { try { sspPushErr('dlc-mask', e && e.message); } catch (e2) { } }
        });
        es.on(et.PERSONA_CHANGED || 'persona_changed', (id) => {
            dlcTempOff.clear();                                   // 换面具 → "临时关"作废（用户定的）
            if (typeof id === 'string' && id) dlcWornCache = id;
            if (orbOpenNow && (orbTab === 'dlc' || orbTab === 'persona')) renderOrbPanel();
        });
        es.on(et.CHAT_CHANGED || 'chat_changed', () => {
            dlcTempOff.clear(); dlcWornCache = '';
            if (orbOpenNow && orbTab === 'dlc') renderOrbPanel();
            /* v1.31.64：这份存档绑了面具就自动戴上（等酒馆自己先把它的 loadPersonaForCurrentChat 跑完） */
            globalThis.setTimeout?.(() => { try { personaChatApply(); } catch (e) { } }, 900);
        });
        bindDlcMaskWatch.done = true;
        return true;
    } catch (e) { return false; }
}
/** 「鼠鼠DLC 全局常驻」开关（用户要的：书得一直加载，条目才有意义） */
function dlcGlobalOn() {
    const s = getSettings();
    if (typeof s.dlcGlobal !== 'boolean') s.dlcGlobal = true;
    return s.dlcGlobal;
}
/** 这本书现在在酒馆那边是不是全局勾着的（读不到返回 null） */
function dlcGlobalSelected() {
    try {
        const sel = document.getElementById('world_info');
        if (!sel) return null;
        const opt = Array.from(sel.options).find(o => (o.textContent || '').trim() === orbDlcBook());
        return opt ? !!opt.selected : null;
    } catch (e) { return null; }
}
/** 勾上 / 去掉「鼠鼠DLC」—— 驱动酒馆自己那个世界书多选框，走它自己的 handler + 保存。
    返回：true 成功 / null 面板还没建出来（那就先不动，DLC 页会提示） / false 出错 */
function dlcGlobalApply(on) {
    try {
        const sel = document.getElementById('world_info');
        if (!sel) return null;
        const opt = Array.from(sel.options).find(o => (o.textContent || '').trim() === orbDlcBook());
        if (!opt) return null;
        if (opt.selected === !!on) return true;                 // 已经是这个状态
        opt.selected = !!on;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    } catch (e) { return false; }
}

/** 编辑表单里的「🎭 面具」一节（只有 DLC 栏有）：点面具名 = 绑 / 解绑（点了立刻存，不用等保存）。
    语义直接写在小字里，免得用户以为"绑了就是不生效"。 */
function dlcFormMasksHTML(e) {
    const uid = String(e.uid);
    const bound = dlcEntryMasks(uid);
    const all = orbPersonas();
    const worn = dlcWornPersona();
    const chips = all.length
        ? all.map(p => {
            const on = bound.indexOf(p.id) >= 0;
            return '<span class="ssp-en-maskchip' + (on ? ' on' : '') + (p.id === worn ? ' worn' : '') + '"'
                + ' data-orb-enmaskchip="' + uid + '" data-orb-enmaskid="' + esc(p.id) + '"'
                + ' title="' + (on ? '点一下解绑' : '点一下绑上') + '">'
                + esc(p.name) + (p.id === worn ? ' · 现在戴着' : '') + '</span>';
        }).join('')
        : '<span class="ssp-en-masknote">读不到面具列表 —— 先在酒馆里打开一次「用户设定」。</span>';
    return '<div class="ssp-en-masks">'
        + '<span class="ssp-en-maskhead">🎭 戴哪些面具时必须有它'
        + (bound.length
            ? '（已选 ' + bound.length + ' 个 · <span class="ssp-en-masklink" data-orb-enmaskclear="' + uid + '">清空</span>）'
            : '（没选＝不绑：一直按你自己的开关）')
        + '</span>'
        + '<div class="ssp-en-maskrow">' + chips + '</div>'
        + '<span class="ssp-en-masknote">戴上其中一个 → 这条自动开；戴着别的面具 → 它关（专属，换走就关）；'
        + '没戴面具 → 按你自己的开关。点一下立刻生效，不用等保存。</span>'
        + '</div>';
}

/** 「给这一条挑面具」那一页（整页替换 DLC 页，跟面具页的"绑定角色"一样） */
function dlcMaskPickerHTML(uid) {
    const key = String(uid);
    const hit = (orbDlcEntries || []).find(e => String(e.uid) === key);
    const title = (hit && String(hit.comment || '').trim()) || ('条目 ' + key);
    const bound = dlcEntryMasks(key);
    const worn = dlcWornPersona();
    const all = orbPersonas();
    const rows = all.length ? all.map(p => {
        const on = bound.indexOf(p.id) >= 0;
        return '<div class="ssp-orb-charrow' + (on ? ' on' : '') + '" data-orb-enmaskid="' + esc(p.id) + '"'
            + ' data-orb-enmaskuid="' + esc(key) + '">'
            + '<img src="' + orbPersonaThumb(p.id) + '" alt="">'
            + '<span class="ssp-orb-charn">' + esc(p.name)
            + (p.id === worn ? '<i class="ssp-en-maskworn">现在戴着</i>' : '') + '</span>'
            + '<span class="ssp-orb-charmark">' + (on ? '<i class="fa-solid fa-check"></i> 已绑' : '<i class="fa-regular fa-circle"></i>') + '</span>'
            + '</div>';
    }).join('') : '<div class="ssp-orb-empty">读不到面具列表 —— 先在酒馆里打开一次「用户设定」面板。</div>';
    return '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-enmaskback="1"><i class="fa-solid fa-arrow-left"></i>返回</span>'
        + '<b>🎭 ' + esc(title) + '</b>'
        + (bound.length ? '<span class="ssp-pbtn danger" data-orb-enmaskclear="' + esc(key) + '">清空</span>' : '')
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">点面具＝绑 / 解绑。'
        + '<b>绑上 = 玩这个面具时必须有它</b>（戴上就自动开）；戴着别的面具时它关（专属）；没戴面具时按你自己的开关。<br>'
        + '<span style="opacity:.75">现在戴着：<b>' + (worn ? esc(dlcPersonaName(worn)) : '（没戴面具）') + '</b></span></div>'
        + '<div class="ssp-orb-charrows">' + rows + '</div>';
}

/* ---- 条目列表 / 编辑器（DLC 栏和世界书栏共用同一套）---- */

/** 状态点 + 标题 + 元信息 的一行（kind='dlc' 或 'book'） */
/** 条目行上那枚面具标记（只有 DLC 栏有）。
    没绑 → 一个淡淡的 🎭（点一下去挑面具）；绑了 → 「🎭 名字 · 现在的状态」。 */
function dlcRowMaskHTML(e) {
    const uid = String(e.uid);
    const names = dlcMaskNames(uid);
    if (!names) {
        return '<span class="ssp-pbtn ssp-en-mask" data-orb-enmask="' + uid + '"'
            + ' title="绑给面具：戴这个面具时必须有它。现在没绑＝一直按你自己的开关。">🎭</span>';
    }
    const st = dlcEntryState(e);
    const label = st.mode === 'on' ? '跟着面具 · 已开'
        : st.mode === 'temp-off' ? '你临时关了'
            : st.mode === 'other-mask' ? ('戴着「' + dlcPersonaName(st.worn) + '」，不生效')
                : '没戴面具 · 按你自己的开关';
    return '<span class="ssp-pbtn ssp-en-mask bound' + (st.effective ? '' : ' dim') + '" data-orb-enmask="' + uid + '"'
        + ' title="点一下改绑哪些面具"><span class="ssp-en-maskname">🎭 ' + esc(names) + '</span>'
        + '<i class="ssp-en-maskstate">' + esc(label) + '</i></span>';
}

/** 条目行。
    ⚠️ 交互是用户定的（改过一版）：
       · **点整行 = 开关这一条**（最常用的动作，占整行的点击面积）
       · **✏ 编辑** = 单独一个按钮（不再靠"点标题展开"，容易和开关抢）
       · **🗑 删除** = 单独按钮，只有 DLC 栏给（世界书栏怕误删别人的书）
       · **🎭 面具** = 只有 DLC 栏给（v1.31.59）
    以前是"点那个点开关、点标题编辑" —— 那个小小的点很难点中（用户反馈点不动），已经废掉。 */
function orbEntryRowHTML(e, book, kind) {
    const uid = e.uid;
    const icon = orbEntryIcon(e);
    const off = e.disable === true;
    const title = (e.comment || '').trim() || ('未命名条目 ' + uid);
    const keys = orbEntryKeys(e);
    const maskOff = (kind === 'dlc') && dlcEntryMasks(uid).length > 0 && !dlcEntryEffective(e);
    const meta = orbEntryStateText(e) + ' · ' + orbEntryLen(e) + ' 字'
        + (keys && !e.constant ? ' · 触发：' + keys : '');
    /* 这一行正在等确认删除 → 在行**下面**展开一条确认（不用酒馆弹窗，见点击处理里的说明） */
    const confirming = (orbDelConfirm !== null && String(orbDelConfirm) === String(uid));
    const row = '<div class="ssp-orb-wrow ssp-en-row' + (off ? ' off' : '') + (maskOff ? ' maskoff' : '') + (confirming ? ' confirming' : '') + '"'
        + ' data-ssp-enrow="' + uid + '" data-ssp-entoggle="' + uid + '" data-ssp-book="' + esc(book) + '"'
        + ' title="点这一行＝' + (off ? '打开' : '关掉') + '「' + esc(title) + '」">'
        + '<span class="ssp-orb-state ssp-en-state">' + icon + '</span>'
        + '<span class="ssp-orb-wname ssp-en-main">'
        + '<b>' + esc(title) + '</b><i class="ssp-en-meta">' + esc(meta) + '</i></span>'
        + (kind === 'dlc' ? dlcRowMaskHTML(e) : '')
        + '<span class="ssp-pbtn ssp-en-edit" data-ssp-enedit="' + uid + '" data-ssp-book="' + esc(book) + '"'
        + ' title="改标题 / 正文 / 常驻方式">✏</span>'
        + (kind === 'dlc'
            ? '<span class="ssp-pbtn ssp-en-del' + (confirming ? ' armed' : '') + '" data-ssp-endel="' + uid + '" data-ssp-book="' + esc(book) + '" title="删掉这一条（会先问一次）">🗑</span>'
            : '')
        + '</div>';
    if (!confirming) return row;
    return row + '<div class="ssp-en-confirm">'
        + '<span class="ssp-en-confirm-t">删掉「' + esc(title) + '」？</span>'
        + '<span class="ssp-pbtn danger" data-ssp-endelete="' + uid + '" data-ssp-book="' + esc(book) + '">'
        + '<i class="fa-solid fa-trash"></i>确认删掉</span>'
        + '<span class="ssp-pbtn" data-ssp-endelcancel="1">算了</span>'
        + '</div>';
}

/** 编辑表单（就地展开） */
function orbEntryFormHTML(e, book, isNew, defaults) {
    const uid = isNew ? '' : e.uid;
    const d = defaults || {};
    const comment = isNew ? String(d.comment || '') : String(e.comment || '');
    const content = isNew ? String(d.content || '') : String(e.content || '');
    const key = isNew ? String(d.key || '') : orbEntryKeys(e);
    const constant = isNew ? (d.constant !== false) : (e.constant === true);
    const adv = (e && e.__adv) === true;
    return '<div class="ssp-en-form" data-ssp-enform="' + uid + '" data-ssp-book="' + esc(book) + '">'
        + '<label class="ssp-en-f"><span>标题</span>'
        + '<input class="ssp-inp" type="text" data-ssp-enf="comment" placeholder="这条叫什么（比如「温不咎的作息」）" value="' + esc(comment) + '"></label>'
        + '<label class="ssp-en-f"><span>正文</span>'
        + '<textarea class="ssp-inp ssp-orb-ta" data-ssp-enf="content" rows="7" placeholder="要补进提示词的那段内容">' + esc(content) + '</textarea></label>'
        + '<div class="ssp-en-state">'
        + '<label class="ssp-orb-auto"><input type="checkbox" data-ssp-enf="constant"' + (constant ? ' checked' : '') + '>'
        + '<span>🔵 常驻（一直生效 · 不用填触发词）</span></label>'
        + '<label class="ssp-orb-auto"><input type="checkbox" data-ssp-enf="adv"' + (adv ? ' checked' : '') + '>'
        + '<span>更多设置</span></label>'
        + '</div>'
        + '<label class="ssp-en-f ssp-en-key"' + (constant ? ' style="display:none"' : '') + '><span>触发词（逗号分隔）</span>'
        + '<input class="ssp-inp" type="text" data-ssp-enf="key" placeholder="说到这些词才插入" value="' + esc(key) + '"></label>'
        + '<div class="ssp-en-adv"' + (adv ? '' : ' style="display:none"') + '>'
        + '<div class="ssp-en-f2">'
        + '<label class="ssp-en-f"><span>顺序 order</span><input class="ssp-inp" type="number" data-ssp-enf="order" value="' + esc(isNew ? 100 : e.order) + '"></label>'
        + '<label class="ssp-en-f"><span>深度 depth</span><input class="ssp-inp" type="number" data-ssp-enf="depth" value="' + esc(isNew ? 4 : e.depth) + '"></label>'
        + '<label class="ssp-en-f"><span>概率 %</span><input class="ssp-inp" type="number" data-ssp-enf="probability" value="' + esc(isNew ? 100 : e.probability) + '"></label>'
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding:0 2px 6px">「插入位置」这类更细的项，等面板不够用了再说 —— 需要的话去酒馆世界书编辑器改，两边是同一份文件。</div>'
        + '</div>'
        /* v1.31.59：DLC 栏才有「🎭 面具」这一节（用户要求只做 DLC 栏，世界书栏一个字不动） */
        + ((String(book) === orbDlcBook())
            ? (isNew
                ? '<div class="ssp-en-masks"><span class="ssp-en-maskhead">🎭 面具</span>'
                    + '<span class="ssp-en-masknote">先创建这一条 —— 创建完在列表里点 🎭 挑面具。</span></div>'
                : dlcFormMasksHTML(e))
            : '')
        + '<div class="ssp-en-acts">'
        + '<span class="ssp-pbtn primary" data-ssp-ensave="' + uid + '" data-ssp-book="' + esc(book) + '">'
        + '<i class="fa-solid fa-check"></i>' + (isNew ? '创建' : '保存') + '</span>'
        + '<span class="ssp-pbtn" data-ssp-encancel="1">取消</span>'
        + '</div></div>';
}

/** 打开某本书的条目页（异步拉条目，回来重画） */
function orbWbOpenEntries(book) {
    orbWbEntriesBook = String(book || '');
    orbWbEntryOpen = null;
    orbWbEntrySearch = '';
    orbWbEntries = [];
    orbWbEntriesLoaded = false;
    orbWbEntriesErr = '';
    renderOrbPanel();
    orbWbEntriesFetch(orbWbEntriesBook);
}
function orbWbCloseEntries(silent) {
    orbWbEntriesBook = '';
    orbWbEntries = [];
    orbWbEntriesLoaded = false;
    orbWbEntriesErr = '';
    orbWbEntryOpen = null;
    orbWbEntrySearch = '';
    if (!silent) return true;
    return true;
}
async function orbWbEntriesFetch(book) {
    const name = String(book || '').trim();
    if (!name) return;
    if (name !== orbWbEntriesBook) return;      // 已经切走了
    orbWbEntriesErr = '';
    try {
        orbWbEntries = await orbEntriesOf(name);
        orbWbEntriesLoaded = true;
    } catch (e) {
        orbWbEntriesErr = String((e && e.message) || e);
        orbWbEntriesLoaded = true;
    }
    if (orbOpenNow && orbTab === 'world' && orbWbEntriesBook === name) renderOrbPanel();
}

/** 编辑器里的小联动：常驻 → 藏触发词；「更多设置」→ 展开高级项 */
function orbEntryFormCascade(host) {
    if (!host) return;
    const c = host.querySelector('[data-ssp-enf="constant"]');
    const key = host.querySelector('.ssp-en-key');
    if (c && key) key.style.display = c.checked ? 'none' : '';
    const adv = host.querySelector('[data-ssp-enf="adv"]');
    const box = host.querySelector('.ssp-en-adv');
    if (adv && box) box.style.display = adv.checked ? '' : 'none';
}

/* 手动「还原这个聊天」：撤销我们启用过的书（用户手动勾的不动） */
function orbWbRestoreCur() {
    const key = orbWbChatKey();
    if (!key) { toast('还没打开聊天', 'warning'); return false; }
    if (!orbWbRecord(key)) { toast('这个聊天没有本扩展启用过的世界书', 'info'); return false; }
    orbWbCleanup(key, 'restore');
    orbWbAutoArmed.delete(key);
    toast('已把本扩展启用的世界书撤掉', 'success');
    return true;
}
/** 切聊天 / 切角色时调用。
    ⚠️ 这里踩过两次坑，都记下来：
      ① 曾经在切换时"还原上一个聊天"→ 那时多选框里已经是**新聊天**的状态，
         拿它当旧聊天的现状去补书，结果把上一张卡的书串进了新聊天。
      ② 曾经把「本扩展启用过哪几本」的记账**跨聊天留着** → 切到新卡后，
         上一张卡点过的书还挂着「本聊天生效」，看着像新卡也认它（用户反馈"你就做干净一点"）。
    现在的做法：切换时①把上一个聊天的记账连同我们启用过的书一起撤掉（**只撤我们启用过的**），
    ②然后按新角色重新对齐。新聊天有自己的世界书状态、由酒馆自己加载，我们不需要补回任何东西。 */
var orbWbLastKey = '';
var orbWbAutoArmed = new Set();   // 这次切换里已经对齐过的聊天键（防止刷两次重复弹提示）
function orbWbOnChatChanged() {
    const nowKey = orbWbChatKey();
    if (orbWbLastKey && orbWbLastKey !== nowKey) {
        try { orbWbCleanup(orbWbLastKey, 'reset'); } catch (e) { }
        orbWbAutoArmed.delete(orbWbLastKey);
    }
    orbWbLastKey = nowKey;
    if (!nowKey) return;
    if (orbWbAutoArmed.has(nowKey)) return;
    [300, 900, 1800].forEach(ms => {
        setTimeout(() => {
            if (orbWbChatKey() !== nowKey) return;             // 又切走了，别乱动
            if (orbWbAutoArmed.has(nowKey)) return;
            const done = orbWbApplyForChar();
            /* 没绑书也算处理过了，省得反复空转 */
            orbWbAutoArmed.add(nowKey);
            if (done && orbOpenNow && orbTab === 'world') renderOrbPanel();
        }, ms);
    });
}
/** 这一栏要不要自动套用（默认开；关掉就只留手动） */
function orbWbAuto() {
    const s = getSettings();
    if (typeof s.worldAuto !== 'boolean') s.worldAuto = true;
    return s.worldAuto;
}

/** 切到这一页时刷一次世界书清单（新建/导入的世界书要能看见） */
function orbWorldRefresh() {
    orbWorldList();
    bindWbWatch();                            // 进世界书页也重试一次（首次拿到上下文后就能挂上）
    /* 下拉选项是酒馆自己填的；酒馆那边还没填过就让它去拿一次（异步，回来再重画） */
    const sel = document.getElementById('world_info');
    const isEmpty = !sel || (sel.options || []).length <= 1;
    if (isEmpty) {
        try {
            const p = (getContext() || {}).updateWorldInfoList?.();
            if (p && p.then) p.then(() => { orbWorldList(); if (orbOpenNow && orbTab === 'world') renderOrbPanel(); }).catch(() => { });
        } catch (e) { }
    }
}

/** 这本书现在是什么状态：'active' 已绑且已启用 / 'bound' 已绑但还没启用（异常态） / '' 没绑
    ⚠️ 干净版**只有这两种**（都基于"这张卡绑了吗"）。
    以前还有第三种「本聊天生效但不属于这张卡」→ 用户切卡后看到上一张卡点过的书还挂着这个标签，
    整个是脏的（实测反馈）。现在那种情况不再显示任何标签。 */
function orbWbState(name) {
    const ch = orbWbTargetChar();
    if (!ch) return '';
    if (orbWbBound(ch.key).indexOf(name) < 0) return '';
    return orbWbActive().indexOf(name) >= 0 ? 'active' : 'bound';
}
/** 这一页取哪个角色的清单：优先当前聊天角色；抽屉里给了 avatar 就听它的 */
function orbWbTargetChar() {
    const cur = orbWbCurChar();
    if (orbWbBinding) {
        const chars = orbCharList();
        const c = chars.find(x => x.id === orbWbBinding);
        if (c) return { id: c.id, key: orbWbCharKey(c.id), name: c.name };
    }
    return cur;
}

/** 「角色卡自带的」那本世界书（卡里 data.extensions.world）。
    只读展示用 —— 绝不写进 worldBinds 绑定表：
      · 酒馆的 getCharacterLore() 会**绕过下拉框**直接把它纳入扫描（chat lore），
        所以在面板里它一直是"没绑"的灰样子，用户会以为它没生效、又去勾一遍。
      · 一旦写进绑定表，orbWbSyncChar() 就会把它当成"我们加的"而在切卡时撤掉它，
        跟酒馆自己的加载打架（6739 那条注释记的就是这个坑）。
    所以这里只读、只显示。 */
function orbWbNativeBook(ch) {
    if (!ch) return '';
    try {
        const ctx = getContext() || {};
        const list = ctx.characters || [];
        let c = list.find(x => x && x.avatar === ch.id);
        if (!c && ctx.characterId !== undefined) {
            const cur = list[ctx.characterId];
            if (cur && (cur.avatar === ch.id || (cur.name && cur.name === ch.name))) c = cur;
        }
        const ex = (c && c.data && c.data.extensions) || {};
        let w = ex.world;
        if (Array.isArray(w)) w = w.length ? w[0] : '';
        return String(w || '').trim();
    } catch (e) { return ''; }
}


function orbWorldRowsHTML() {

    const all = orbWorldList();
    const ch = orbWbTargetChar();
    if (!all.length) {
        return '<div class="ssp-orb-empty">没读到世界书清单。<br>'
            + '（世界书是空的，或者酒馆那边还没加载完 —— 刷新一下页面再进来看看）</div>';
    }
    const bound = ch ? orbWbBound(ch.key) : [];
    const q = orbWbSearch.toLowerCase();
    /* 先按分类标签过滤，再按搜索词过滤（两者叠加） */
    const inCat = all.filter(n => orbWbCat === ORB_CAT_ALL ? true
        : (orbWbCat === '' ? !orbWbCatOf(n) : orbWbCatOf(n) === orbWbCat));
    const hit = inCat.filter(n => !q
        || String(n).toLowerCase().indexOf(q) >= 0
        || orbWbCharNames(n).join('、').toLowerCase().indexOf(q) >= 0);
    if (!hit.length) {
        if (orbWbSearch) return '<div class="ssp-orb-empty">没有匹配「' + esc(orbWbSearch) + '」的世界书。<br>（搜的是：世界书名 / 绑过它的角色卡名）</div>';
        if (orbWbCat === '') return '<div class="ssp-orb-empty">所有世界书都分好类了。<br>（点书名右边那个 <i class="fa-solid fa-folder"></i> 能把书从分类里拿出来）</div>';
        if (orbWbCat !== ORB_CAT_ALL) return '<div class="ssp-orb-empty">「' + esc(orbWbCat) + '」里还没有书。<br>（点书名右边那个 <i class="fa-solid fa-folder"></i> 把书归进来）</div>';
        return '<div class="ssp-orb-empty">没读到世界书清单。<br>（世界书是空的，或者酒馆那边还没加载完 —— 刷新一下页面再进来看看）</div>';
    }
    const head = (orbWbSearch || orbWbCat !== ORB_CAT_ALL)
        ? '<div class="ssp-orb-pcount">' + (orbWbCat !== ORB_CAT_ALL ? '「' + esc(orbWbCat || '未分类') + '」' : '')
            + (orbWbSearch ? '筛出 ' : '共 ') + hit.length + ' / ' + all.length + ' 本世界书</div>'
        : '';
    /* 顶部：这张卡**自带**的世界书（只读）。
       酒馆靠 getCharacterLore() 直接加载它，不走这个多选框，所以下面列表里它永远是"没绑"的样子
       —— 用户会以为没生效、又去勾一遍。这里说清楚，免得重复选。 */
    const nativeBook = orbWbNativeBook(ch);
    const nativeBanner = (ch && nativeBook)
        ? '<div class="ssp-wb-native">'
            + '<i class="fa-solid fa-book-bookmark"></i>'
            + '<span>这张卡自带：<b>' + esc(nativeBook) + '</b>'
            + (all.indexOf(nativeBook) >= 0
                ? '（酒馆自动生效，不用在这里选）'
                : '（酒馆里没这本书，可能被删了）') + '</span>'
        + '</div>'
        : '';
    const rows = hit.map(n => {
        const st = orbWbState(n);
        const mine = (bound.indexOf(n) >= 0);
        const cat = orbWbCatOf(n);
        /* 干净版：白框（.on）＋ 🔖 只表示「这张卡绑了它」。
           绑了就是生效中（绑定即生效），所以竖条和它永远同步 ——
           不再有"本聊天生效但不属于这张卡"这种悬空状态（用户反馈过那是脏的）。 */
        const others = orbWbCharNames(n).filter(x => !ch || x !== ch.name);
        /* 「谁绑了这本书」已由 orbWbCharNames 一并给出（含卡自带绑定），
           这里直接用；当前这张卡自己不再重复露脸（白框 + 生效中已经表达了）。 */
        const whoBinds = others;
        /* 这行小字＝**谁绑了这本书**（反向查）。旧版只在"别的卡也绑了"时才显示，
           一本没人共用的书就写死"没有别的角色卡绑它"，信息量等于零。 */
        const bindLine = whoBinds.length
            ? esc(whoBinds.join('、')) + ' 也绑了'
            : (ch ? '没有别的角色卡绑它' : '还没有角色卡绑它');
        const tip = !ch ? '先在酒馆里打开一个聊天，才能给角色卡配绑定'
            : (mine ? '点一下＝从「' + ch.name + '」解绑，并从本聊天撤掉'
                : '点一下＝绑给「' + ch.name + '」，并在本聊天启用');
        /* 分类挑选用抽屉式（就地展开），不放 select —— 手机上好点 */
        const allCats = orbWbCatNames();
        let picker = '';
        if (orbWbCatPick === n) picker = orbCatPickHTML({ book: n, cats: allCats, cur: cat, P: 'data-orb-catpick', S: 'data-orb-catset' });
        else if (orbWbCatNew === n) picker = orbCatNewHTML({ at: n, hint: '新分类叫什么（比如：世界观 / 规则）…' });
        return '<div class="ssp-orb-prowwrap' + (orbWbCatPick === n ? ' picking' : '') + '">'
            + '<div class="ssp-orb-prow' + (mine ? ' on ssp-wb-mine ssp-wb-active' : '') + '"'
            + (ch ? ' data-orb-wtoggle="' + esc(n) + '"' : '') + ' title="' + esc(tip) + '">'
            + '<div class="ssp-orb-wbox"><i class="fa-solid ' + (mine ? 'fa-bookmark' : 'fa-square') + '"></i></div>'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(n)
            + (st === 'active' ? '<span class="ssp-orb-ptag">生效中</span>' : '')
            + (st === 'bound' ? '<span class="ssp-orb-ptag">已绑·未启用</span>' : '')
            + '</div>'
            + '<div class="ssp-orb-pbind' + (whoBinds.length ? ' has' : '') + '" title="' + esc(whoBinds.join('、')) + '"><i class="fa-solid fa-link"></i>'
            + bindLine + '</div>'
            + '</div>'
            /* 归到哪个分类（文件夹）：点了就地展开一排分类按钮 */
            + '<span class="ssp-pbtn ssp-wb-catbtn' + (cat ? ' has' : '') + '" data-orb-catpick="' + esc(n) + '"'
            + ' title="' + (cat ? '在分类「' + esc(cat) + '」里 —— 点一下改' : '归到一个分类（文件夹）') + '">'
            + '<i class="fa-solid ' + (cat ? 'fa-folder-open' : 'fa-folder') + '"></i></span>'
            /* 这一本书里的条目：点进去看 / 开关 / 改（用户要的"连里面条目也可以开"） */
            + '<span class="ssp-pbtn ssp-wb-open" data-orb-wentries="' + esc(n) + '"'
            + ' title="展开这本书里的条目，逐条开关 / 编辑">📖</span>'
            + '</div>'
            + picker
            + '</div>';
    }).join('');
    return head + nativeBanner + '<div class="ssp-orb-plist">' + rows + '</div>';
}

/** 条目列表 HTML（世界书栏的"展开"页和 DLC 栏共用一套长相与行为）
    ctx = { entries, book, editing, kind, search, loaded, err } */
function orbEntryListHTML(ctx) {
    const c = ctx || {};
    const book = String(c.book || '');
    const q = String(c.search || '').toLowerCase();
    if (!c.loaded) return '<div class="ssp-orb-empty">正在读「' + esc(book) + '」…</div>';
    if (c.err) return '<div class="ssp-orb-empty">读不出来：' + esc(c.err) + '</div>';
    const all = c.entries || [];
    if (!all.length) return '<div class="ssp-orb-empty">这本书还是空的' + (c.kind === 'dlc' ? ' —— 点「＋新建条目」写第一条。' : '。') + '</div>';
    /* v1.31.59：DLC 栏那三个筛选（全部 / 只给面具的 / 没绑的）；世界书栏不受影响 */
    const filtering = (c.kind === 'dlc' && orbDlcFilter !== 'all');
    const maskHit = (e) => {
        if (!filtering) return true;
        const bound = dlcEntryMasks(e.uid).length > 0;
        return orbDlcFilter === 'mask' ? bound : !bound;
    };
    const hit = all.filter(e => maskHit(e) && (!q
        || String(e.comment || '').toLowerCase().indexOf(q) >= 0
        || String(e.content || '').toLowerCase().indexOf(q) >= 0
        || orbEntryKeys(e).toLowerCase().indexOf(q) >= 0));
    if (!hit.length) {
        if (filtering) return '<div class="ssp-orb-empty">这个筛选下没有条目 —— 换个筛选看看。</div>';
        return '<div class="ssp-orb-empty">没有匹配「' + esc(c.search) + '」的条目。</div>';
    }
    const head = (q || filtering) ? '<div class="ssp-orb-pcount">筛选出 ' + hit.length + ' / ' + all.length + ' 条</div>' : '';
    const rows = hit.map(e => {
        let html = orbEntryRowHTML(e, book, c.kind);
        if (c.editing != null && String(c.editing) === String(e.uid)) html += orbEntryFormHTML(e, book, false);
        return html;
    }).join('');
    return head + '<div class="ssp-orb-wlist">' + rows + '</div>';
}

/** 世界书栏「展开某本书的条目」那一页 */
function orbWbEntriesHTML() {
    const book = orbWbEntriesBook;
    const rows = orbEntryListHTML({
        entries: orbWbEntries, book, editing: orbWbEntryOpen, kind: 'book',
        search: orbWbEntrySearch, loaded: orbWbEntriesLoaded, err: orbWbEntriesErr,
    });
    const q = orbWbEntrySearch || '';
    const bar = '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-enesearch="1" placeholder="搜条目（标题 / 正文 / 触发词）" value="' + esc(q) + '">'
        + (q ? '<span class="ssp-pbtn" data-orb-eneclear="1">清除</span>' : '')
        + '</div>';
    const head = '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-wback2="1"><i class="fa-solid fa-arrow-left"></i>回世界书</span>'
        + '<b>' + esc(book) + ' · 条目</b>'
        + '<span class="ssp-orb-charmark" style="margin-left:auto">' + orbWbEntries.length + ' 条</span>'
        + '</div>';
    const tools = '<div class="ssp-orb-pcount">'
        + '<span class="ssp-pbtn primary" data-orb-enenew="1"><i class="fa-solid fa-plus"></i>新建条目</span>'
        + '<span class="ssp-pbtn" data-orb-enerefresh="1"><i class="fa-solid fa-rotate"></i>刷新</span>'
        + '</div>';
    const draft = (orbWbEntryOpen === 'new')
        ? orbEntryFormHTML(null, book, true, orbWbEntryDraft || { comment: '', content: '', key: '', constant: orbDlcConstantDefault() })
        : '';
    const note = '<div class="ssp-orb-empty" style="padding-top:4px">'
        + '🔵常驻 🟢关键词触发 🔗向量化 ❌已关闭 —— 点那个点就是开关，点标题展开就能改。'
        + '<br><span style="opacity:.7">改动直接写回这本书（酒馆里那份同步生效；两边是同一份文件）。</span></div>';
    return head + bar + tools + draft + '<div id="ssp_orb_wbent_list">' + rows + '</div>' + note;
}

function orbWorldHTML() {
    if (orbWbEntriesBook) return orbWbEntriesHTML();
    const all = orbWorldList();
    const ch = orbWbTargetChar();
    const cur = orbWbCurChar();
    const act = orbWbActive();
    const bound = ch ? orbWbBound(ch.key) : [];
    const applied = bound.filter(n => act.indexOf(n) >= 0);       // 绑了且已启用
    const otherChar = (orbWbBinding && (!cur || orbWbBinding !== cur.id)) ? ch : null;

    const foot = '<div class="ssp-orb-empty" style="padding-top:6px">'
        + (ch
            ? '正在配 <b>' + esc(ch.name) + '</b>' + (otherChar ? '（不是当前聊天的角色）' : '')
                + '：绑了 <b>' + bound.length + '</b> 本' + (bound.length ? '（' + esc(bound.join('、')) + '）' : '') + '<br>'
            : '还没打开聊天 —— 先在酒馆里打开一个聊天，这里才能给角色卡配绑定。<br>')
        + (ch && bound.length
            ? '本聊天已按这张卡启用：<b>' + esc(applied.length ? applied.join('、') : '（还没启用）') + '</b>'
            : '')
        + '<br><span style="opacity:.75">点世界书名 = 加/减这张卡的绑定 —— '
        + '<b>绑上就启用、解绑就撤掉</b>，一一对应，不会留下跟这张卡无关的书。'
        + '<b>一张卡能绑多本</b>；切到别的卡时，这里会换成那张卡的绑定。</span>'
        + '</div>';

    const bar = '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-wsearch="1" placeholder="搜世界书 / 角色卡" value="' + esc(orbWbSearch) + '">'
        + (orbWbSearch ? '<span class="ssp-pbtn" data-orb-wclear="1">清除</span>' : '')
        + '</div>';

    /* 分类标签栏（通用构造器，番外那边共用） */
    const cats = orbWbCatNames();
    const allCount = all.length;
    const uncatCount = orbWbCatCount('');
    const catCounts = { [ORB_CAT_ALL]: allCount, '': uncatCount };
    cats.forEach(c => { catCounts[c] = orbWbCatCount(c); });
    const catBar = orbCatBarHTML({
        cats, active: orbWbCat, edit: orbWbCatEdit, counts: catCounts,
        D: 'data-orb-cat', P: 'data-orb-catpick', S: 'data-orb-catset',
        A: 'data-orb-catadd', E: 'data-orb-catedit', R: 'data-orb-catrename', X: 'data-orb-catdel',
    });

    const tools = '<div class="ssp-orb-pcount">'
        + '<label class="ssp-orb-auto"><input type="checkbox" data-orb-wauto="1"' + (orbWbAuto() ? ' checked' : '')
        + '><span>切到绑定的角色卡时自动启用（切走自动撤掉）</span></label>'
        + (applied.length ? '<br><span class="ssp-pbtn" data-orb-wrestore="1"><i class="fa-solid fa-rotate-left"></i>'
            + '撤掉本扩展启用的 ' + applied.length + ' 本（手动勾的不动）</span>' : '')
        + (otherChar ? '<br><span class="ssp-pbtn" data-orb-wback="1"><i class="fa-solid fa-arrow-left"></i>回到当前聊天角色</span>' : '')
        + (bound.length ? '<br><span class="ssp-pbtn" data-orb-wclearall="1"><i class="fa-solid fa-eraser"></i>清空「'
            + esc(ch.name) + '」的全部绑定</span>' : '')
        + '</div>';

    /* 抽屉里给了 avatar（不在绑定页了，改成"切到别的角色配"入口）—— 这里给一个选角色的下拉 */
    const chars = orbCharList();
    const picker = (cur && chars.length)
        ? '<div class="ssp-orb-pcount">给别的角色卡配：<select class="ssp-inp" data-orb-wchar="1" style="max-width:220px">'
            + '<option value="">（当前：' + esc(cur.name) + '）</option>'
            + chars.filter(c => c.id !== cur.id).map(c => '<option value="' + esc(c.id) + '"'
                + (orbWbBinding === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')
            + '</select></div>'
        : '';

    if (!all.length) return orbWorldRowsHTML() + bar + catBar + tools + foot;
    return bar + catBar + tools + picker + '<div id="ssp_orb_world_list">' + orbWorldRowsHTML() + '</div>' + foot;
}

/** 这一页不再需要单独的绑定页（绑定就地点；orbWbBinding 现在只表示"在看哪张卡"） */
function orbWorldPickerHTML(charAvatar) {
    orbWbBinding = charAvatar || null;
    return orbWorldHTML();
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

/* ===== 番外分类（文件夹）=====
   和世界书那边不同：番外的归类**记在记录自己身上**（n.cat），没有单独的表。
   好处是删分类 / 改分类名都只是改一串字符串，不会出现"分类表里挂着已删的番外"。
   ⚠️ 但这样"刚建好、还没归任何番外"的分类会无处记录 —— 所以另存一个"待用分类"集合
   （s.noteCats = ['日常', …']），让空分类也能留在标签栏上；归进第一条番外后就成真了。 */
function orbNoteCatPending() {
    const s = getSettings();
    if (!Array.isArray(s.noteCats)) s.noteCats = [];
    s.noteCats = s.noteCats.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
    return s.noteCats;
}
/** 番外分类名 = 记录上出现过的 + 待用的（去重、排序） */
function orbNoteCatNames() {
    const set = new Set();
    orbNotes().forEach(n => { const c = String((n && n.cat) || '').trim(); if (c) set.add(c); });
    orbNoteCatPending().forEach(c => set.add(c));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
}
/** 这条番外属于哪个分类（'' = 未分类） */
function orbNoteCatOf(n) { return String((n && n.cat) || '').trim(); }
/** 某分类里有几条番外 */
function orbNoteCatCount(cat) {
    const list = orbNotes();
    if (!cat) return list.filter(n => !orbNoteCatOf(n)).length;
    return list.filter(n => orbNoteCatOf(n) === cat).length;
}
/** 建一个分类名（重名返回 false）。空分类存进"待用"集合，这样标签栏上看得见 */
function orbNoteCatAdd(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    if (orbNoteCatNames().indexOf(n) >= 0) return false;
    orbNoteCatPending().push(n);
    save();
    return true;
}
/** 解散分类：清掉这些番外身上的 cat + 从待用集合里删掉（番外本身一条都不删） */
function orbNoteCatDel(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    let hit = 0;
    orbNotes().forEach(x => { if (orbNoteCatOf(x) === n) { delete x.cat; hit++; } });
    const pend = orbNoteCatPending();
    const i = pend.indexOf(n);
    if (i >= 0) { pend.splice(i, 1); hit++; }
    if (hit) save();
    return hit > 0;
}
/** 改分类名：番外整体改名 + 待用集合也跟着改；重名则拒绝。
    ⚠️ 重名要在**改之前**查：改完源分类就消失了，那时再查 `from` 已经不在列表里，
    会把"改成一个已存在的名字"误判成不冲突（自测 9c.33 抓到的）。 */
function orbNoteCatRename(from, to) {
    const f = String(from || '').trim(), n = String(to || '').trim();
    if (!f || !n) return false;
    if (f === n) return true;                       // 改成自己 = 没变，当成功
    if (orbNoteCatNames().indexOf(f) < 0) return false;
    if (orbNoteCatNames().indexOf(n) >= 0) return false;   // 目标已存在
    let hit = 0;
    orbNotes().forEach(x => { if (orbNoteCatOf(x) === f) { x.cat = n; hit++; } });
    const pend = orbNoteCatPending();
    const i = pend.indexOf(f);
    if (i >= 0) { pend[i] = n; hit++; }
    if (orbNCat === f) orbNCat = n;
    if (hit) save();
    return true;
}
/** 把一条番外归到某个分类；cat 传 '' = 移出（未分类） */
function orbNoteCatSet(id, cat) {
    const rec = orbNotes().find(n => n.id === id);
    if (!rec) return false;
    const c = String(cat || '').trim();
    if (c) rec.cat = c; else delete rec.cat;
    const pend = orbNoteCatPending();
    const i = pend.indexOf(c);
    if (i >= 0) pend.splice(i, 1);          // 真名字出现了，不用再靠"待用"占位
    save();
    return true;
}
/** 别的地方删番外时把它身上的 cat 一起带走（这里是空操作，留着提醒不要写出「半删」） */
function orbNoteCatForget(id) { return !!orbNotes().find(n => n.id === id); }

function orbSaveNote(id, title, text) {
    const list = orbNotes();
    const t = String(title || '').trim();
    const body = String(text || '');
    if (!t && !body.trim()) return null;
    let rec = id ? list.find(n => n.id === id) : null;
    if (rec) { rec.title = t; rec.text = body; rec.at = Date.now(); }   // 编辑时不碰 cat
    else {
        rec = { id: orbNewId(), title: t, text: body, at: Date.now() };
        /* 在两个「已存在」的分类标签下新建 → 自动归进那个分类（用户要的"直接在标签页里新增"）。
           未分类( '' ) / 全部 两个标签下就不写 cat。 */
        if (orbNCat && orbNCat !== ORB_CAT_ALL) rec.cat = orbNCat;
        list.unshift(rec);
    }
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

/* ============================ 写卡（把酒馆的写卡块搬进口袋）============================
   用户诉求：「在角色管理面板写卡太麻烦」→ 把**制作/写卡**搬进鼠鼠口袋（其余不动）。
   做法：把酒馆自己的 **`#rm_ch_create_block`**（`<form id="form_create">` 整块，159 行）
   临时搬进「写卡」页签，关掉面板/切走页签再**原地还家**。
   为什么能这么干（核过酒馆源码，不是猜）：
     · 保存完全按 id 取值：`script.js:9695 new FormData($('#form_create').get(0))`，
       字段全是 `#character_name_pole` / `#description_textarea` … → **搬走不影响保存**
     · 酒馆只有**一行**代码依赖它在右侧抽屉里：`script.js:8799`
       `switchMenu && selectRightMenuWithAnimation('rm_ch_create_block')` → 我们把它拦成"进口袋"
     · `#advanced_div`（高级编辑）里的字段是**运行时注入**的，跟着块走，不用管
   风险与对策：
     · 酒馆想把块收回去时，我们的选择器只认"它在不在我们这儿"，不再动它 → 不会把它搬丢
     · 面板关掉 / 切页签 / 扩展关闭 → 一律还家（`orbEditorUnmount`）
   ========================================================================== */
/* ============================ 写卡：自设计「写卡工作台」（v1.31.50 重做）============================
   用户原话：「我的意思是保留接口用来连接酒馆原生功能，面板单独设计，怎么方便怎么来」。
   所以这一版把上一版（v1.31.46~49 那套"把酒馆原生 DOM 搬进分页"）**整个删掉**，改成两件事：

   ① **面板自己设计**：字段由我们自己画（VAULT_SCHEMA 一张表），不再搬酒馆的容器/标题/抽屉。
      好处是上一版那些坑一次性消失：重画把字段带进坟墓、flex 基准宽度把作者注释挤成 88px、
      分页与直排两套样式打架、摘 id 找原生元素的骚操作……
   ② **只留一层接口**：原生控件全部留在 `#form_create` / `#character_popup` 里不动，
      用 pin 样式藏起来（元素还在文档里 → FormData 拿得到、`$('#id').val()` 读得到、
      酒馆的回填写得进），我们只做三件事：
        · 开卡 **pull**：把我的输入框按原生元素的值填上（值以文档里那份为准）
        · 保存前 **push**：把我的输入框写回原生元素（酒馆随后照旧 `new FormData()` 提交）
        · 原生按钮 **触发**：头像 / 标签 / 备选开场白 / 世界书 / 提示词覆盖 → 点酒馆自己那颗

   ⚠️ 三条不许动的底线（改之前先读 README 的"写卡"章节）：
   1) `#description_textarea` 这些元素**必须留在文档里** —— 酒馆是 `new FormData($('#form_create')[0])`
      + `$('#description_textarea').val()` 直接读 DOM；拿掉或脱链就等于把卡写一半。
   2) push 必须发生在酒馆的 submit 处理**之前** → 监听 `document` 捕获阶段的 `submit`，
      捕获永远跑在 jQuery 的委托（`$('#form_create').on('submit', …)`）前面。
   3) 我的按钮**不能**冒充提交控件：`#create_button` 是 `type=submit`，它一定留在原生表单里，
      我们只在外面 `click()` 它；我们自己绝不放 submit 按钮。
   ========================================================================== */

const VAULT_PIN = 'ssp-ch-native';
/** 酒馆那两个容器的 id（**接口**，永不能改）：
    · `rm_ch_create_block` = 写卡块（`#rm_ch_create_block`，"新建/编辑角色"那一整块）
    · `character_popup`    = 高级定义弹窗（里面装着提示词覆盖、深度提示词、话痨度、示例对话…）
    ⚠️ 之前这两个常量在我重写这一段时**被弄丢了**（只剩引用、没有声明）→ `getElementById(undefined的常量)`
       会抛 ReferenceError，被各处 try/catch 吞掉 → 表现是"pin 完全没生效"+"原生界面状态怪怪的"。
       这类"常量丢了"的 bug 很难从现象上看出来，所以**常量声明都集中放这里**。 */
const CH_EDIT_ID = 'rm_ch_create_block';
const CH_POPUP_ID = 'character_popup';

/* 字段表：
   id   = 酒馆原生元素 id（**接口**，永不能改）
   k    = 我们自己的控件键（pull/push 靠它找控件）
   mode = textarea | input | number | select | special
   hint = 行下面的小灰字 */
const VAULT_SCHEMA = [
    { id: 'character_name_pole', k: 'name', label: '卡名', mode: 'input', ph: '这张卡叫什么（必填）' },

    { id: 'creator_notes_textarea', k: 'notes', label: '作者注释', group: 'notes', mode: 'textarea', rows: 6, ph: '写卡人自己看的说明／给用户的使用提示' },
    { id: 'creator_textarea', k: 'creator', label: '作者', group: 'notes', mode: 'input', ph: '你的名字 / 联系方式' },
    { id: 'character_version_textarea', k: 'ver', label: '版本', group: 'notes', mode: 'input', ph: '1.0' },
    { id: 'tags_textarea', k: 'tags', label: '标签', group: 'notes', mode: 'textarea', rows: 2, ph: '逗号分隔，如：日常, 治愈' },
    { id: 'character_world', k: 'world', label: '世界书', group: 'notes', mode: 'special', ph: '未绑定' },

    { id: 'description_textarea', k: 'desc', label: '角色描述', group: 'persona', mode: 'textarea', rows: 11, ph: '外貌、身份、性格、经历、说话习惯……（给 AI 看的核心设定）' },
    { id: 'personality_textarea', k: 'persona', label: '性格摘要', group: 'persona', mode: 'textarea', rows: 5, ph: '一句话人设（很多卡留空也不用）' },
    { id: 'scenario_pole', k: 'scenario', label: '场景', group: 'persona', mode: 'textarea', rows: 5, ph: '故事发生在哪、现在什么状况' },

    { id: 'firstmessage_textarea', k: 'first', label: '开场白', group: 'dialog', mode: 'textarea', rows: 12, ph: '角色说的第一句话，会直接开一场新聊天' },
    { id: 'mes_example_textarea', k: 'example', label: '对话示例', group: 'dialog', mode: 'textarea', rows: 10, ph: '示例对话用 <START> 分隔（酒馆的写法）' },

    { id: 'system_prompt_textarea', k: 'system', label: '主提示词覆盖', group: 'adv', mode: 'textarea', rows: 5, hint: '留空＝用全局主提示词' },
    { id: 'post_history_instructions_textarea', k: 'phi', label: '历史后指令', group: 'adv', mode: 'textarea', rows: 5, hint: '插在对话历史之后，优先级很高' },
    { id: 'depth_prompt_prompt', k: 'dpp', label: '深度提示词', group: 'adv', mode: 'textarea', rows: 4 },
    { id: 'depth_prompt_depth', k: 'dpd', label: '深度', group: 'adv', mode: 'number', min: 0, max: 9999 },
    { id: 'depth_prompt_role', k: 'dpr', label: '角色', group: 'adv', mode: 'select' },
    { id: 'talkativeness_slider', k: 'talk', label: '话痨度', group: 'adv', mode: 'select' },
];

/* 我们自己的分页：按"写卡时先想什么"排，不按酒馆的字段顺序 */
const CH_TABS = [
    { id: 'persona', name: '人设', icon: 'fa-user-pen' },
    { id: 'dialog', name: '对话', icon: 'fa-comments' },
    { id: 'notes', name: '卡信息', icon: 'fa-circle-info' },
    { id: 'adv', name: '高级', icon: 'fa-sliders' },
];
let chTab = 'persona';

/** 分组标题（组头那行） */
const VAULT_GROUPS = {
    base: ['这张卡是谁', 'fa-id-card'],
    notes: ['作者注释 · 卡列表里显示的那段简介', 'fa-comment-dots'],
    persona: ['人设 · 给 AI 看的内容', 'fa-user-pen'],
    dialog: ['对话 · 开场白与示例', 'fa-comments'],
    adv: ['Prompt 覆盖 · 高级', 'fa-sliders'],
};

/** 分页 → 这张表里要显示哪些字段 */
function chTabFields(tab) {
    const pick = (g) => VAULT_SCHEMA.filter(f => (f.group || 'base') === g);
    if (tab === 'persona') return pick('base').concat(pick('persona'));
    if (tab === 'dialog') return pick('dialog');
    if (tab === 'notes') return pick('notes');
    return pick('adv');
}
/** 一个字段属于哪张表（原生 input 派发回来时用得上） */
function chFldById(id) { return VAULT_SCHEMA.find(f => f.id === id) || null; }

/* ---------------- 接口层①②：pull / push ---------------- */

/** 值从**文档里那份**读（`getElementById`，不是我们手里的缓存引用） */
function chVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

/** 把文档里那份值抄回我的控件（**不动 chDirty 记账**）。
    ⚠️ 切页签会重画分页 → 新控件是空的，必须抄回来，否则"切走再切回，字没了"（e2e 抓到）。
       值以**原生元素**为准：用户的每一次输入都已经同步过去了（见 chBindNativeOnce）。 */
function chSetMine() {
    let n = 0;
    VAULT_SCHEMA.forEach(f => {
        if (f.mode === 'special') return;
        const el = document.getElementById(f.id);
        const mine = chMine(f.k);
        if (!el || !mine) return;
        const v = String(el.value == null ? '' : el.value);
        if (mine.value !== v) mine.value = v;
        n += 1;
    });
    try { chCount(); } catch (e) { }
    return n;
}

/** pull：原生 → 我的控件（开卡/切卡/新建时调） */
function chPull(quiet) {
    chCache = {};
    let n = 0;
    VAULT_SCHEMA.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        chCache[f.id] = String(el.value == null ? '' : el.value);
    });
    n = chSetMine();
    try { chFillSelects(); } catch (e) { }                // 话痨度 / 深度角色两个下拉的选项
    try { chRefreshSpecial(); } catch (e) { }
    try { chRefreshAvatars(); } catch (e) { }
    try { chCount(); } catch (e) { }
    try { chRefreshHead(); } catch (e) { }
    try { chSyncFav(); } catch (e) { }
    chDirty = {};
    if (!quiet) chSay('已读取这张卡的内容');
    return n;
}

/** push：我的控件 → 原生（保存前调）。
    ⚠️ 只在"用户动过"时才写（chDirty 记账），绝不把空值盖到原生上
       —— 否则没写过字的字段会被清空，那是**改坏卡**。 */
function chPush(quiet) {
    if (chPushing) return 0;
    chPushing = true;
    let n = 0;
    try {
        VAULT_SCHEMA.forEach(f => {
            if (!(f.id in chDirty)) return;               // 没动过就不碰
            const mine = chMine(f.k);
            if (!mine) return;
            const el = document.getElementById(f.id);
            if (!el) return;
            const v = (mine.value == null) ? '' : String(mine.value);
            if (el.value !== v) {
                el.value = v;
                /* ⚠️ 派发要用 bubbles:false：冒泡到 document 会被我们自己的 onNative
                   抓住再抄回我的框（值一样所以不炸，但白跑一圈） */
                try { el.dispatchEvent(new Event('input', { bubbles: false })); } catch (e) { }
                try { el.dispatchEvent(new Event('change', { bubbles: false })); } catch (e) { }
            }
            n += 1;
        });
        /* 备选开场白：不在上面那 16 个字段里，单独记一笔（它改的是活数组，见 chGreetSave） */
        if (chGreetDirty) { try { chGreetPush(); } catch (e) { } n += 1; }
    } finally { chPushing = false; }
    /* 标签：原生表单收的是 `#tags_textarea`（我们那张），但卡列表里的 ★／筛选栏读的是
       `#tagList` 里的标签节点 → 顺手同步一份显示 */
    try { if ('tags_textarea' in chDirty) chSyncTagChips(); } catch (e) { }
    if (!quiet && n) chSay('已把 ' + n + ' 处改动写回酒馆');
    return n;
}

/** 标签 chips 同步（只做显示层，不碰酒馆的 tag map 逻辑） */
function chSyncTagChips() {
    const host = document.getElementById('tagList');
    if (!host) return false;
    const raw = chVal('tags_textarea');
    const parts = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
    host.innerHTML = parts.map(t => '<div class="tag">' + esc(t) + '</div>').join('');
    return true;
}

/* ---------------- 我的控件 ---------------- */
function chMine(k) { return sspTabRoot().querySelector('#ssp_orb_panel [data-chk="' + k + '"]'); }

/** 控件渲染：一律带 data-chk（pull/push 都靠它找），data-chid 记原生 id */
function chFldHTML(f) {
    const a = [
        'data-chk="' + f.k + '"',
        'data-chid="' + f.id + '"',
        'placeholder="' + esc(f.ph || '') + '"',
        'autocomplete="off"',
        'spellcheck="false"',
    ].join(' ');
    if (f.mode === 'textarea') return '<textarea class="ssp-ch-inp" rows="' + (f.rows || 5) + '" ' + a + '></textarea>';
    if (f.mode === 'number') return '<input class="ssp-ch-inp" type="number" min="' + (f.min == null ? 0 : f.min) + '" max="' + (f.max == null ? 9999 : f.max) + '" ' + a + '>';
    if (f.mode === 'select') return '<select class="ssp-ch-inp" ' + a + '></select>';
    if (f.mode === 'special') {
        return '<div class="ssp-ch-special">'
            + '<span class="ssp-ch-sv" data-chsv="' + f.k + '">未绑定</span>'
            + '<span class="ssp-pbtn ssp-ch-mini" data-choverlay="1" title="打开酒馆自己的世界书选择器"><i class="fa-solid fa-book-atlas"></i> 选择世界书</span>'
            + '<span class="ssp-pbtn ssp-ch-mini" data-choverlay="2" title="打开酒馆自己的额外世界书（charLore）"><i class="fa-solid fa-layer-group"></i> 额外</span>'
            + '</div>';
    }
    return '<input class="ssp-ch-inp" type="text" ' + a + '>';
}

function chRowHTML(f) {
    const wide = (f.mode === 'textarea') || (f.mode === 'special');
    const tail = (f.id === 'tags_textarea')
        ? '<datalist id="ssp_ch_tags_pool"></datalist>'
        + '<div class="ssp-ch-hint">标签用**逗号**分隔。写过的标签会被记下来，下次点输入框就有候选。</div>'
        : (f.id === 'firstmessage_textarea' ? '<div data-chgreetslot="1"></div>' : '');
    return '<div class="ssp-ch-vrow' + (wide ? ' wide' : '') + '" data-chrow="' + f.k + '">'
        + '<div class="ssp-ch-vlab"><span>' + esc(f.label) + '</span>'
        + (f.mode === 'textarea' ? '<i class="ssp-ch-cnt" data-chcnt="' + f.k + '"></i>' : '')
        + '</div>'
        + '<div class="ssp-ch-vbody">' + chFldHTML(f) + tail
        + (f.hint ? '<div class="ssp-ch-hint">' + f.hint + '</div>' : '')
        + '</div></div>';
}

/** 分页内容：按分组搭"组框 + 行"（对话页不留组头，省一行的位置） */
function chGroupsHTML(tab) {
    const fs = chTabFields(tab);
    const groups = [];
    fs.forEach(f => {
        const g = f.group || 'base';
        let it = groups.find(x => x.g === g);
        if (!it) { it = { g: g, fs: [] }; groups.push(it); }
        it.fs.push(f);
    });
    return groups.map(it => {
        const meta = VAULT_GROUPS[it.g];
        const ghead = (tab === 'dialog' && it.g === 'dialog')
            ? ''
            : '<div class="ssp-ch-vghead"><i class="fa-solid ' + ((meta && meta[1]) || 'fa-circle') + '"></i>'
            + esc((meta && meta[0]) || '字段') + '</div>';
        /* 人设页最上面那格是头像（触发酒馆原生的选图 + 裁剪） */
        const avrow = (it.g === 'base') ? chAvatarRowHTML() : '';
        return '<div class="ssp-ch-vgroup" data-chg="' + it.g + '">' + ghead
            + '<div class="ssp-ch-vgbody">' + avrow + it.fs.map(chRowHTML).join('') + '</div></div>';
    }).join('');
}

/** 头像行：预览 + 我们的按钮（转发到酒馆原生控件）+ 被藏起来的原生 label/file（接口层③） */
function chAvatarRowHTML() {
    return '<div class="ssp-ch-vrow ssp-ch-avrow wide" data-chavrow="1">'
        + '<div class="ssp-ch-av" data-chavprev="1"><i class="fa-solid fa-user"></i></div>'
        + '<div class="ssp-ch-avbox">'
        + '<div class="ssp-ch-avlab">头像</div>'
        + '<div class="ssp-ch-avbtns">'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chavbtn="1"><i class="fa-solid fa-image"></i> 换头像</span>'
        + '<span class="ssp-ch-avtrig" data-chavtrig="1"></span>'
        + '</div>'
        + '<div class="ssp-ch-hint">点「换头像」走的是酒馆自己的选图与裁剪（png / jpg；webp 酒馆会自己转）</div>'
        + '</div></div>';
}

/** 切页签：**只重画分页内容**，标题栏 / 保存条 / 原生那排按钮一律不动
    ⚠️ 这是上一版最大的教训 —— 整块重画会把原生控件带进坟墓（我们会重挂，但原生那排的
       事件与状态不好恢复），所以能只换分页就只换分页。 */
function chSyncTabUI() {
    const panel = document.getElementById('ssp_orb_panel');
    if (!panel) return false;
    panel.querySelectorAll('[data-orb-cftab]').forEach(b => b.classList.toggle('on', b.dataset.orbCftab === chTab));
    panel.querySelectorAll('[data-orb-cfpane]').forEach(p => p.classList.toggle('on', p.dataset.orbCfpane === chTab));
    return true;
}
function chPanesLoad(force) {
    const panel = sspPanelEl();
    if (!panel) return false;
    panel.querySelectorAll('[data-orb-cfpane]').forEach(p => {
        const t = p.dataset.orbCfpane;
        if (force || !p.firstElementChild) p.innerHTML = chGroupsHTML(t);
    });
    chSyncTabUI();
    /* ⚠️ 分页是重画出来的 → 控件都是空的，必须把值抄回来（切走再切回不能丢字） */
    try { chSetMine(); } catch (e) { }
    try { chRefreshAvatars(); } catch (e) { }
    try { chFillSelects(); } catch (e) { }
    try { chCount(); } catch (e) { }
    /* 备选开场白：把"列表"挂进开场白那一行下面的槽里（分页内容里只放了个占位 div） */
    try {
        panel.querySelectorAll('[data-chgreetslot]').forEach(slot => {
            if (slot.firstElementChild) return;
            const box = document.createElement('div');
            box.className = 'ssp-ch-greets';
            box.setAttribute('data-chgreets', '1');
            slot.appendChild(box);
        });
        chGreetRender();
    } catch (e) { }
    try { chTagsDatalist(); } catch (e) { }
    return true;
}
/** 骨架即将被换掉：先 push + 回收原生浮层，并记下"重画后要重挂写卡页" */
let chPanesLoadedTab = false;
function chUnmountFrameSoft() {
    if (orbTab !== 'editor') return false;
    try { chPush(true); } catch (e) { }
    try { chOverlayClose(); } catch (e) { }
    chPanesLoadedTab = true;
    return true;
}
/** 面板关掉时调（bindOrb 里用它）：彻底放开 pin 与浮层 */
function chDirtyReset() { chDirty = {}; chGreetDirty = false; return true; }
/** 保存成功后清记账：这些改动已经进卡了，不该再拿去 push */
function chPanesClear() { chDirty = {}; chGreetDirty = false; return true; }

/* 写卡页签的两个"一次性"标记：骨架铺好了 / 值读进来了。
   ⚠️ 必须在**重画前**先记下来（重画时 DOM 还是旧的那一份），见 renderOrbPanel。 */
let chSkelOk = false;
let chPulledOnce = false;

/* ---------------- 备选开场白：自设计的**列表**（可排序 / 可分组） ----------------
   数据在哪（核过 script.js）：
     · 编辑已有卡：`characters[chid].data.alternate_greetings`（**活对象**，数组）
     · 新建卡：`create_save.alternate_greetings`
   保存时（script.js:9815 / 9724）酒馆会 `formData.delete('alternate_greetings')`，
   再从这个数组一条条 append → 所以我们只管改这个数组，然后调 `chSave()` 提交就行。
   ⚠️⚠️ **这个数组只吃字符串**（血泪教训）：
        我先试过把一条变成 `{ text, group }` 对象 —— 数组里确实是对象（e2e 里 typeof 是 object），
        但**服务端把它强转成字符串存了**（`String({})` → 卡的 JSON 里出现 `"[object Object]"`，
        原文直接丢了）。所以分组信息**必须塞进字符串本身**。
   做法：分组时把内容写成 `[分组名]正文`（marker 在最前，分组名里不能有 `[]` 和换行）。
        · 不加前缀 = 未分组，看起来就是普通字符串 → 第三方客户端读到的还是干净原文；
        · marker 是我们自己认的，酒馆只当普通文本（原生那个备选开场白框里会看到 `[日常]你好`，
          反而在原生界面里也看得出分组，不算坏事）。 */
const CH_GREET_MARK = /^\[([^\]\r\n]{1,24})\]\s?/;      // `[分组]正文`
let chGreetOpen = -1;          // 正在展开编辑的是第几条
let chGreetPick = '';          // 分组筛选：'' = 全部
let chGreetDirty = false;      // 备选开场白改过没有（它不在 chDirty 那套记账里）

function chCreateSave() { try { return (getContext() || {}).create_save || null; } catch (e) { return null; } }
function chCreating() {
    const f = document.getElementById('form_create');
    return !!(f && String(f.getAttribute('actiontype') || '') === 'createcharacter');
}
/** 当前角色的活数组（拿不到就返回 null，不抛） */
function chGreetArr() {
    try {
        if (chCreating()) {
            const cs = chCreateSave();
            if (!cs) return null;
            if (!Array.isArray(cs.alternate_greetings)) cs.alternate_greetings = [];
            return cs.alternate_greetings;
        }
        const ctx = getContext() || {};
        const ch = (ctx.characters || [])[ctx.characterId];
        if (!ch) return null;
        if (!ch.data) ch.data = {};
        if (!Array.isArray(ch.data.alternate_greetings)) ch.data.alternate_greetings = [];
        return ch.data.alternate_greetings;
    } catch (e) { return null; }
}
/** 原始串（带 marker 的那份，提交给酒馆的就是它） */
function chGreetRaw(g) { return (typeof g === 'string') ? g : String((g && (g.text || g)) || ''); }
/** 去掉 marker 的正文 */
function chGreetText(g) { return chGreetRaw(g).replace(CH_GREET_MARK, ''); }
/** marker 里的分组名（没有就空串） */
function chGreetGroup(g) {
    const m = CH_GREET_MARK.exec(chGreetRaw(g));
    return m ? String(m[1]).trim() : '';
}
/** 按「分组 + 正文」拼回一条（分组空 → 不带 marker，纯正文） */
function chGreetPack(text, group) {
    const gp = String(group || '').trim().replace(/[\[\]\r\n]/g, '');
    const tx = String(text == null ? '' : text);
    return gp ? ('[' + gp + ']' + tx) : tx;
}
function chGreetSetText(i, text) {
    const a = chGreetArr(); if (!a || !(i in a)) return false;
    a[i] = chGreetPack(text, chGreetGroup(a[i]));
    return true;
}
function chGreetSetGroup(i, grp) {
    const a = chGreetArr(); if (!a || !(i in a)) return false;
    a[i] = chGreetPack(chGreetText(a[i]), grp);
    return true;
}
function chGreetMove(i, dir) {
    const a = chGreetArr(); if (!a) return false;
    const j = i + dir;
    if (i < 0 || j < 0 || i >= a.length || j >= a.length) return false;
    const t = a[i]; a[i] = a[j]; a[j] = t;
    chGreetOpen = j;
    return chGreetSave();
}
function chGreetDel(i) {
    const a = chGreetArr(); if (!a || !(i in a)) return false;
    a.splice(i, 1);
    if (chGreetOpen >= a.length) chGreetOpen = -1;
    return chGreetSave();
}
function chGreetAdd() {
    const a = chGreetArr();
    if (!a) { toast('拿不到这张卡的备选开场白（先在酒馆里打开一次它）', 'warning'); return false; }
    a.push('');
    chGreetOpen = a.length - 1;
    chGreetPick = '';
    return chGreetSave();
}
/** 分组名清单（按出现顺序，去重） */
function chGreetGroups() {
    const a = chGreetArr() || [];
    const out = [];
    a.forEach(g => { const k = chGreetGroup(g); if (k && out.indexOf(k) < 0) out.push(k); });
    return out;
}
/** 数组改了之后：立刻落回"要提交的那份" + 重画列表 + 同步字数。
    ⚠️ 备选开场白的改动**不在 VAULT_SCHEMA 里**（不是那 16 个输入框），
       所以 `chDirty` 那套记账抓不到它 —— 必须自己记 `chGreetDirty`，
       否则"只改了开场白就点保存"会一个字都不提交（e2e 抓到过）。 */
function chGreetSave() {
    chGreetDirty = true;
    try { chGreetPush(); } catch (e) { }
    chGreetRender();   // 整块重画：分组 chip / datalist / 预览 都要跟着变
    try { chCount(); } catch (e) { }
    return true;
}
/** 把"备选开场白"同步进原生表单：给 `#tags_textarea` 式的原生字段一个即时反馈不值得，
    真正要保证的是**提交时一定带上**（chSave 会读活数组）。这里只把原生的那个模板节点标个计数，
    方便调试与 e2e 观察。 */
function chGreetPush() {
    try {
        const tpl = document.querySelector('#alternate_greetings_template .alternate_greetings_list');
        const a = chGreetArr() || [];
        if (tpl) tpl.dataset.sspCount = String(a.length);
    } catch (e) { }
    return true;
}
function chGreetPreview(t) {
    /* 传进来的是原始串，先剥掉 [分组] 前缀再预览 */
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return s ? esc(s.slice(0, 46)) : '<i class="ssp-ch-dim">（还没写内容）</i>';
}
function chGreetRowsHTML() {
    const a = chGreetArr() || [];
    const show = a.map((g, i) => ({ g: g, i: i })).filter(x => !chGreetPick || chGreetGroup(x.g) === chGreetPick);
    if (!show.length) {
        return '<div class="ssp-ch-empty">' + (a.length
            ? '这个分组下没有开场白（点上面的「全部」看其它）'
            : '还没有备选开场白：点「加一条」开始写（新聊天时它们会变成开场白的左右滑动）') + '</div>';
    }
    return show.map(x => {
        const g = x.g, i = x.i;
        const grp = chGreetGroup(g);
        const open = (chGreetOpen === i);
        return '<div class="ssp-ch-grow' + (open ? ' open' : '') + '" data-chgrow="' + i + '">'
            + '<div class="ssp-ch-ghead2" data-chgtoggle="' + i + '">'
            + '<span class="ssp-ch-gidx">' + (i + 1) + '</span>'
            + '<span class="ssp-ch-gtxt">' + chGreetPreview(chGreetText(g)) + '</span>'
            + (grp ? '<span class="ssp-ch-gtag">' + esc(grp) + '</span>' : '')
            + '<span class="ssp-ch-gops">'
            + '<span class="ssp-pbtn ssp-ch-mini ssp-ch-icon" data-chgup="' + i + '" title="上移"><i class="fa-solid fa-chevron-up"></i></span>'
            + '<span class="ssp-pbtn ssp-ch-mini ssp-ch-icon" data-chgdown="' + i + '" title="下移"><i class="fa-solid fa-chevron-down"></i></span>'
            + '<span class="ssp-pbtn ssp-ch-mini ssp-ch-icon" data-chgdel="' + i + '" title="删掉这条"><i class="fa-solid fa-trash"></i></span>'
            + '</span></div>'
            + (open
                ? '<div class="ssp-ch-gbody2">'
                + '<textarea class="ssp-ch-inp" rows="9" data-chgtext="' + i + '" placeholder="这条开场白的内容（新聊天时作为开场白的备选滑动）">' + esc(chGreetText(g)) + '</textarea>'
                + '<label class="ssp-ch-grow2"><span>分组</span>'
                + '<input class="ssp-ch-inp" type="text" list="ssp_ch_ggroups" data-chggroup="' + i + '" value="' + esc(grp) + '" placeholder="（留空＝未分组）如：日常 / 黑化 / 支线">'
                + '</label></div>'
                : '')
            + '</div>';
    }).join('');
}
/** 只更新"筛选条 + 候选清单"（**不碰行列表**）——
    改分组时用这个：行列表一重画，用户正在输入的那一格就被销毁、焦点会掉（体验很糟）。 */
function chGreetChipsRender() {
    const host = sspTabRoot().querySelector('#ssp_orb_panel [data-chgreets]');
    if (!host) return false;
    const groups = chGreetGroups();
    const bar = host.querySelector('.ssp-ch-gbar');
    if (bar) {
        bar.innerHTML = ['<span class="ssp-ch-chip' + (chGreetPick ? '' : ' on') + '" data-chgpick="">全部</span>']
            .concat(groups.map(k => '<span class="ssp-ch-chip' + (chGreetPick === k ? ' on' : '') + '" data-chgpick="' + esc(k) + '">' + esc(k) + '</span>'))
            .join('') + '<span class="ssp-sp"></span>'
            + '<span class="ssp-pbtn ssp-ch-mini" data-chgadd="1"><i class="fa-solid fa-plus"></i> 加一条</span>';
    }
    const dl = document.getElementById('ssp_ch_ggroups');
    if (dl) dl.innerHTML = groups.map(k => '<option value="' + esc(k) + '"></option>').join('');
    return true;
}
/** 只重画行列表（筛选栏 / datalist 不动，这样改分组时**不会打断正在输入的那一格**） */
function chGreetRowsRender() {
    const host = sspTabRoot().querySelector('#ssp_orb_panel [data-chgreets]');
    if (!host) return false;
    const row = host.querySelector('.ssp-ch-glist');
    if (row) row.innerHTML = chGreetRowsHTML();
    return true;
}
function chGreetRender() {
    const host = sspTabRoot().querySelector('#ssp_orb_panel [data-chgreets]');
    if (!host) return false;
    const groups = chGreetGroups();
    const chips = ['<span class="ssp-ch-chip' + (chGreetPick ? '' : ' on') + '" data-chgpick="">全部</span>']
        .concat(groups.map(k => '<span class="ssp-ch-chip' + (chGreetPick === k ? ' on' : '') + '" data-chgpick="' + esc(k) + '">' + esc(k) + '</span>'))
        .join('');
    host.innerHTML = ''
        + '<datalist id="ssp_ch_ggroups">' + groups.map(k => '<option value="' + esc(k) + '"></option>').join('') + '</datalist>'
        + '<div class="ssp-ch-gbar">' + chips
        + '<span class="ssp-sp"></span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chgadd="1"><i class="fa-solid fa-plus"></i> 加一条</span>'
        + '</div>'
        + '<div class="ssp-ch-glist">' + chGreetRowsHTML() + '</div>';
    return true;
}

/** 备选开场白那一行（放在「对话」分页、开场白下面） */
function chGreetRowHTML() {
    const a = chGreetArr() || [];
    return '<div class="ssp-ch-vrow wide" data-chgreetrow="1">'
        + '<div class="ssp-ch-vlab"><span>备选开场白</span>'
        + '<i class="ssp-ch-cnt">' + (a.length ? (a.length + ' 条') : '') + '</i></div>'
        + '<div class="ssp-ch-vbody"><div class="ssp-ch-greets" data-chgreets="1"></div></div></div>';
}

/* ---------------- 标签：自己画的输入框 + 酒馆现成标签的自动补全 ----------------
   为什么要自己画：原生那个「标签补全」在口袋里点不到实处（`.tag_controls` 那一坨
   是给酒馆自己的布局准备的）。这里做成：逗号分隔的输入框 + `<datalist>` 自动补全，
   候选＝酒馆里已有的标签（`ctx.tags`）∪ 我们见过并记下来的标签。 */
function chTagPool() {
    const set = [];
    try {
        const tags = (getContext() || {}).tags;
        if (Array.isArray(tags)) tags.forEach(t => { if (t && t.name) set.push(String(t.name)); });
    } catch (e) { }
    try {
        const mine = getSettings().sspTagPool;
        if (Array.isArray(mine)) mine.forEach(t => { if (t && set.indexOf(String(t)) < 0) set.push(String(t)); });
    } catch (e) { }
    return set.slice(0, 500);
}
/** 把当前标签池记下来（酒馆的 ctx.tags 有时还没加载） */
function chTagsRecollect() {
    try {
        const s = getSettings();
        if (!Array.isArray(s.sspTagPool)) s.sspTagPool = [];
        String(chVal('tags_textarea') || '').split(',').map(x => x.trim()).filter(Boolean).forEach(t => {
            if (s.sspTagPool.indexOf(t) < 0) s.sspTagPool.push(t);
        });
        if (s.sspTagPool.length > 300) s.sspTagPool = s.sspTagPool.slice(-300);
        save();
    } catch (e) { }
    return true;
}
/** 标签的候选清单（贴到 datalist 上） */
function chTagsDatalist() {
    const host = document.getElementById('ssp_ch_tags_pool');
    if (!host) return false;
    const pool = chTagPool();
    const sig = pool.join(',');
    if (host.dataset.chsig === sig) return true;
    host.dataset.chsig = sig;
    host.innerHTML = pool.map(t => '<option value="' + esc(t) + '"></option>').join('');
    return true;
}


/** 写卡页签的 HTML。只**首次**铺一次骨架（切页签只重画分页内容，见 chPanesRender） */
function orbEditorHTML() {
    const form = document.getElementById('form_create');
    const act = form ? String(form.getAttribute('actiontype') || '') : '';
    const editing = (act === 'editcharacter');
    const tabs = CH_TABS.map(t => '<span class="ssp-ch-tab' + (t.id === chTab ? ' on' : '') + '" data-orb-cftab="' + t.id + '">'
        + '<i class="fa-solid ' + t.icon + '"></i>' + esc(t.name) + '</span>').join('');
    const panes = CH_TABS.map(t => '<div class="ssp-ch-pane' + (t.id === chTab ? ' on' : '')
        + ' ssp-ch-pane-' + t.id + '" data-orb-cfpane="' + t.id + '">' + chGroupsHTML(t.id) + '</div>').join('');
    return ''
        /* 顶栏：新建 / 打开原生列表 / 现在在写哪张卡 */
        + '<div class="ssp-ch-bar">'
        + '<span class="ssp-pbtn primary" data-orb-chnew="1"><i class="fa-solid fa-user-plus"></i> 新建空白卡</span>'
        + '<span class="ssp-pbtn" data-orb-chtolist="1" title="管卡 / 导入 / 标签 / 分页在酒馆原生列表里"><i class="fa-solid fa-list-ul"></i> 打开卡列表</span>'
        + '<span class="ssp-ch-now" data-chnow="1"></span>'
        + '</div>'
        + '<div class="ssp-ch-tabs">' + tabs + '</div>'
        /* 保存条：只有「保存」「★」「字数」「…更多」。
           ⚠️ **原生按钮一颗都不搬进来**（踩过，见下面「更多操作」的注释）。 */
        + '<div class="ssp-ch-draft" id="ssp_vault_savebar">'
        + '<span class="ssp-pbtn primary" data-chsave="1"><i class="fa-solid fa-floppy-disk"></i><span data-chsavelabel="1">保存</span></span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chfav="1" title="收藏 / 取消收藏（转发给酒馆那颗 ★）"><i class="fa-solid fa-star"></i></span>'
        + '<span class="ssp-sp"></span>'
        + '<span class="ssp-ch-say" data-chsay="1"></span>'
        + '<span class="ssp-ch-total" data-chtotal="1"></span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chmore="1" title="更多操作（转发给酒馆原生的那几颗按钮）"><i class="fa-solid fa-ellipsis"></i></span>'
        + '</div>'
        /* 「更多操作」：图标全是**我们自己画的**，点下去用 chNative() 转发给酒馆原生的按钮。
           ⚠️ 为什么不把原生按钮搬进来（真踩过，用户看到"找不到酒馆的按钮/星星不见了"）：
              酒馆会重建写卡块与按钮容器；我们搬走的按钮，在"面板重画 + 原来那个家已经脱链"
              的那一刻会变成**孤儿**（不在文档里）→ 之后再点就是"找不到"。
              **不搬 = 这一整类 bug 消失**：原生按钮永远待在酒馆自己的位置上（被 CSS 藏起来），
              我们只是"隔空点它"。 */
        + '<div class="ssp-ch-toolsbar" data-chmorebox="1" hidden>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chavbtn="1" title="走酒馆自己的选图与裁剪"><i class="fa-solid fa-image"></i> 换头像</span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chnative="advanced_div" title="酒馆原生的高级定义面板"><i class="fa-solid fa-book"></i> 高级定义</span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chnative="world_button" title="酒馆原生的角色世界书"><i class="fa-solid fa-globe"></i> 世界书</span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chnative="open_alternate_greetings" title="酒馆原生的备选开场白面板（我们自己的列表在上面）"><i class="fa-solid fa-comment-medical"></i> 原生开场白</span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chnative="char_connections_button" title="酒馆原生的「连接的面具」"><i class="fa-solid fa-face-smile"></i> 面具连接</span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chnative="dupe_button" title="复制这张卡"><i class="fa-solid fa-clone"></i> 复制</span>'
        + '<span class="ssp-pbtn ssp-ch-mini" data-chnative="export_button" title="导出并下载"><i class="fa-solid fa-file-export"></i> 导出</span>'
        + '<span class="ssp-pbtn ssp-ch-mini danger" data-chnative="delete_button" title="删掉这张卡"><i class="fa-solid fa-skull"></i> 删除</span>'
        + '</div>'
        + panes
        /* 原生浮层（世界书选择器 / 额外世界书）用的时候搬进来挂这儿 */
        + '<div class="ssp-ch-ovl" id="ssp_vault_overlay" hidden></div>';
}

/* ---------------- 头像（原生 file 选择器 + 原生裁剪留在酒馆那边） ---------------- */
function chAvatarSrc() {
    try {
        const c = (orbCardsList() || [])[(getContext() || {}).characterId];
        if (c && c.avatar && c.avatar !== 'none') return '/characters/' + encodeURIComponent(c.avatar);
    } catch (e) { }
    return '';
}
/** 头像预览：优先用酒馆自己刚设好的预览图（用户挑的新图就是它），否则用当前卡的头像 */
function chRefreshAvatars() {
    const host = sspTabRoot().querySelector('#ssp_orb_panel [data-chavprev]');
    if (!host) return false;
    const form = document.getElementById('form_create');
    const act = form ? String(form.getAttribute('actiontype') || '') : '';
    const pick = document.getElementById('avatar_load_preview');
    let src = '';
    if (pick && pick.getAttribute) {
        const s = String(pick.getAttribute('src') || '');
        const isDefault = /(^|\/)img\/|default_.*\.png$|ai4\.png$/i.test(s);
        if (s && !isDefault) src = s;                 // 用户刚挑的图 → 就是它
    }
    if (!src && act === 'editcharacter') src = chAvatarSrc();
    host.innerHTML = src
        ? '<img src="' + esc(src) + '" alt="avatar">'
        : '<i class="fa-solid fa-user"></i>';
    host.classList.toggle('on', !!src);
    return true;
}

/* ---------------- 世界书那行：显示当前绑定 ---------------- */
function chWorldInfoLabel() {
    const v = chVal('character_world');
    if (!v) return { text: '未绑定', cls: '' };
    let extra = '';
    try {
        const names = orbWbCharNames(v);
        if (names && names.length) extra = ' ＋' + names.length + ' 个额外世界书';
    } catch (e) { }
    return { text: v + extra, cls: ' on' };
}
function chRefreshSpecial() {
    const sp = sspTabRoot().querySelector('#ssp_orb_panel [data-chsv="world"]');
    if (!sp) return false;
    const w = chWorldInfoLabel();
    sp.textContent = w.text;
    sp.className = 'ssp-ch-sv' + w.cls;
    return true;
}

/* ---------------- 话痨度 / 深度角色：跟着原生控件的选项走 ---------------- */
function chFillSelects() {
    [['talkativeness_slider', 'talk'], ['depth_prompt_role', 'dpr']].forEach(([nid, k]) => {
        const nat = document.getElementById(nid);
        const mine = chMine(k);
        if (!nat || !mine) return;
        /* 原生那个是 range 或 select：把选项抄过来（range 就做成一串离散档位） */
        const opts = [];
        if (nat.tagName === 'SELECT') {
            Array.prototype.forEach.call(nat.options, o => opts.push([o.value, o.textContent || o.value]));
        } else {
            const min = Number(nat.min || 0), max = Number(nat.max || 1), step = Number(nat.step || .05);
            for (let v = min; v <= max + 1e-9; v += step) {
                const val = (Math.round(v * 1000) / 1000);
                opts.push([String(val), (val * 100).toFixed(0) + '%' + (Math.abs(val - .5) < 1e-9 ? '（默认）' : '')]);
            }
        }
        const cur = String(nat.value == null ? '' : nat.value);
        const sig = opts.map(o => o[0]).join(',') + '|' + cur;
        if (mine.dataset.chsig === sig) {
            if (mine.value !== cur) mine.value = cur;
            return;                                   // 没变就不重画（别打断用户）
        }
        mine.dataset.chsig = sig;
        mine.innerHTML = opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
        if (cur) mine.value = cur;
    });
    return true;
}

/* ---------------- 字数 ---------------- */
function chCount() {
    let total = 0;
    sspTabRoot().querySelectorAll('#ssp_orb_panel [data-chk]').forEach(el => {
        const f = chFldById(el.dataset.chid || '');
        if (!f || f.mode === 'special') return;
        const n = String(el.value || '').length;
        total += n;
        const c = sspTabRoot().querySelector('#ssp_orb_panel [data-chcnt="' + f.k + '"]');
        if (c) c.textContent = n ? String(n) : '';
    });
    const tot = sspTabRoot().querySelector('#ssp_orb_panel [data-chtotal]');
    if (tot) tot.textContent = total ? ('共 ' + total + ' 字') : '';
    return total;
}

/* ---------------- 原生浮层：搬进来用（可逆，关掉还回原位） ---------------- */
let chOvl = null;            // { key, host, home:{parent,next}, el }
const CH_OVERLAYS = {
    1: ['#WorldInfo', '世界书'],
    2: ['#world_popup', '额外世界书'],
};

/** 钉住/放开一个原生元素（钉住 = 藏但留在文档里；放开 = 还原）。
    ⚠️ **实测过的三层坑**（别退回成"只写 data 属性"）：
      ① 光靠 CSS 属性选择器 `[data-ssp-ch-pin="1"]{display:none!important}` 挡不住
         酒馆自己的 `#rm_ch_create_block{display:block!important}`（它特异性更高）；
      ② 改写成内联 `style="display:none!important"` 也挡不住 —— 酒馆切右侧抽屉时是
         **jQuery 的 show()**，它写 `style="display:block!important"`，同权重下**后写的赢**，
         于是块又冒出来盖在面板上（elementFromPoint 命中的就是它，手机实测）；
      ③ 结论：用一张**注入的样式表**，选择器带 `#id`（ID 特异性压过 `#rm_ch_create_block`），
         并且把内联样式**接管**掉（不要跟 jQuery 比谁后写）。
       放开时把样式表整张移除 + 还原原有的内联值。 */
const CH_PIN_STYLE_ID = 'ssp_ch_pin_style';
/** ⚠️ **绝不藏 `#rm_ch_create_block` / `#form_create`**。
    用户实测反馈：「怎么我酒馆原生的角色卡界面什么都没有了」——
    把整个写卡块藏起来等于把**酒馆自己的角色编辑界面弄没了**，那不是"看不见的接口"，
    而是用户随时会去用的一等公民界面。
    我们只在**面板开着的时候**、按需藏掉两个**浮层**：
      · `#character_popup`（高级定义）—— 面板里的「高级定义」按钮会把它搬进面板当字段宿主，
        搬家前那一下不能让它先在外面闪出来；
      · `#WorldInfo` / `#world_popup`（世界书选择器）—— 同理，由 `chOverlay()` 搬进面板。
    面板一关就整张样式表撤掉 → 酒馆那边永远是原样。 */
const CH_PIN_SEL = '#character_popup, #WorldInfo, #world_popup, #avatar_controls, #avatar_div_div, #rm_button_back';
function chPinSheet(on) {
    try {
        let st = document.getElementById(CH_PIN_STYLE_ID);
        if (on) {
            if (!st) {
                st = document.createElement('style');
                st.id = CH_PIN_STYLE_ID;
                /* ⚠️ 特异性要 2 个 ID、而且**必须写在目标元素自己身上**：
                      `#avatar_controls:not(#__ssp_never)` —— `:not(#__ssp_never)` 永远成立，
                      于是等价于 `#avatar_controls`，但特异性是 2 个 ID，压得过酒馆自己的
                      `#xxx{display:block!important}`（1 个 ID）。
                      踩过的两个写法（都错）：
                        · 写成 `.ssp-ch-xxx{...!important}` → 特异性不够（1 个 class），被酒馆压掉；
                        · 写成 `#ssp_orb_panel:not(#__x)#avatar_controls` → 这是**复合选择器**，
                          要求**同一个元素**同时有这两个 id，永远匹配不到 → 等于什么都没藏（实测才发现）。 */
                st.textContent = CH_PIN_SEL.split(',').map(s => s.trim() + ':not(#__ssp_never)').join(',')
                    + '{ display: none !important; }';
                (document.head || document.documentElement).appendChild(st);
            }
        } else if (st) {
            st.remove();
        }
    } catch (e) { return false; }
    return true;
}
/** 钉住/放开一个原生元素。
    ⚠️ 现在**只写 data 属性**（样式表按需注入/整张撤掉）——
       绝不碰元素的内联 style，免得给酒馆留下 `style="display:none"` 的残渣。 */
function chPin(el, on) {
    if (!el) return false;
    try {
        if (on) {
            if (el.dataset.sspChPin !== '1') el.dataset.sspChPin = '1';
            chPinSheet(true);
        } else {
            if (el.dataset.sspChPin !== undefined) delete el.dataset.sspChPin;
            if (!document.querySelector('[data-ssp-ch-pin]')) chPinSheet(false);
        }
    } catch (e) { return false; }
    return true;
}
/** 开某个原生浮层：搬进我们的宿主，关掉时还回原位 */
function chOverlay(which) {
    const key = String(which);
    const cfg = CH_OVERLAYS[key];
    if (!cfg) return false;
    if (chOvl && chOvl.key === key) { chOverlayClose(); return true; }   // 再点一下＝收起
    chOverlayClose();
    const el = document.querySelector(cfg[0]);
    if (!el) { toast('找不到酒馆的「' + cfg[1] + '」面板（先把世界书按钮点开一次）', 'warning'); return false; }
    const host = sspById('ssp_vault_overlay');
    if (!host) return false;
    chOvl = { key: key, host: host, el: el, home: { parent: el.parentElement, next: el.nextElementSibling } };
    try {
        host.hidden = false;
        host.innerHTML = '';
        host.appendChild(el);                       // 搬（可逆）
        chPin(el, true);                            // 搬进来的时候才钉（关掉 chOverlayClose 会放开）
    } catch (e) { chOvl = null; return false; }
    return true;
}
function chOverlayClose() {
    if (!chOvl) return false;
    const rec = chOvl;
    chOvl = null;
    try { chPin(rec.el, false); } catch (e) { }      // 搬进来的浮层要**放开**（别留着坏状态）
    try {
        const home = rec.home;
        if (rec.el && home && home.parent && home.parent.isConnected !== false) {
            if (home.next && home.next.parentElement === home.parent) home.parent.insertBefore(rec.el, home.next);
            else home.parent.appendChild(rec.el);
        }
    } catch (e) { }
    try { if (rec.host) { rec.host.hidden = true; rec.host.innerHTML = ''; } } catch (e) { }
    try { chRefreshSpecial(); } catch (e) { }
    return true;
}

/* ---------------- 保存条 / 按钮 ---------------- */
function chSay(txt, kind) {
    const el = sspTabRoot().querySelector('#ssp_orb_panel [data-chsay]');
    if (!el) return false;
    el.textContent = txt || '';
    el.className = 'ssp-ch-say' + (kind ? ' ' + kind : '');
    if (txt) {
        try {
            clearTimeout(chSay.t);
            chSay.t = setTimeout(() => { try { el.textContent = ''; } catch (e) { } }, 2600);
        } catch (e) { }
    }
    return true;
}
/** 收藏状态：以**酒馆原生那颗按钮**为准。
    ⚠️ 别看 `#fav_checkbox` 的 `value` 属性 —— 酒馆是 `$('#fav_checkbox').prop('checked', state)`
       改的是 **property**（`value` 属性一直是初始的空串，读它永远是"没收藏"）。
       可靠的两个信号：`#favorite_button` 上的 `fav_on` class、以及 checkbox 的 `.checked`。 */
function chSyncFav() {
    const btn = sspTabRoot().querySelector('#ssp_orb_panel [data-chfav]');
    if (!btn) return false;
    let on = false;
    try {
        const fb = document.getElementById('favorite_button');
        const cb = document.getElementById('fav_checkbox');
        on = !!(fb && fb.classList && fb.classList.contains('fav_on'))
            || !!(cb && cb.checked === true);
    } catch (e) { }
    btn.classList.toggle('on', on);
    return on;
}
/** 原生按钮转发：`data-chnative="<id 或选择器>"` 一律点酒馆那颗。
    ⚠️ 有些原生入口**没有 id、只有 class**（`#open_alternate_greetings` 根本不存在，
       那是 `.open_alternate_greetings`；`#tag_controls` 同样不存在，是 `.tag_controls`）——
       实测就是这里弹的"找不到酒馆的按钮"。所以找不到 id 时**退回选择器查找**。 */
function chNative(idOrSel) {
    if (!idOrSel) return false;
    const el = chNativeEl(idOrSel);
    if (!el) { toast('找不到酒馆的按钮 / 面板：' + idOrSel, 'warning'); return false; }
    try { el.click(); } catch (e) { toast('触发失败：' + (e && e.message), 'warning'); return false; }
    setTimeout(() => {
        try { chRefreshSpecial(); } catch (e) { }
        try { chRefreshAvatars(); } catch (e) { }
        try { chSyncFav(); } catch (e) { }
        try { chFillSelects(); } catch (e) { }
    }, 260);
    return true;
}
/** 找原生元素：按 id → **按 class** → 按选择器。
    ⚠️ 这里踩过两次：
       · 酒馆有些入口**只有 class 没有 id**（`.open_alternate_greetings` / `.tag_controls`），
         只查 id 会弹"找不到"；
       · 但把裸词直接丢给 `querySelector` 也不对 —— `querySelector('open_alternate_greetings')`
         是拿它当**标签名**查，永远找不到。所以裸词必须试 `.名字`。 */
function chNativeEl(idOrSel) {
    try {
        const s = String(idOrSel);
        if (/^[A-Za-z_][\w-]*$/.test(s)) {
            const byId = document.getElementById(s);
            if (byId) return byId;
            const byCls = document.querySelector('.' + s);      // 只有 class 的入口
            if (byCls) return byCls;
            const byTag = document.querySelector(s);
            if (byTag) return byTag;
            return null;
        }
        return document.querySelector(s) || null;
    } catch (e) { return null; }
}

/** 保存条初始化：骨架已经是新的（按钮写在 orbEditorHTML 里），这里只把状态对齐 */
function chSavebarInit() {
    const bar = sspById('ssp_vault_savebar');
    if (!bar) return false;
    try { chSyncFav(); } catch (e) { }
    try { chCount(); } catch (e) { }
    return true;
}
/** 收藏状态（给"★"上色用） */
function chIsFav() {
    try {
        const c = (orbCardsList() || [])[(getContext() || {}).characterId];
        if (c && (c.fav === true || c.fav === 'true')) return true;
    } catch (e) { }
    try { return String((getSettings() || {}).orbFavOn) === '1'; } catch (e) { }
    return false;
}
/** 一次性归位：早期版本把原生按钮/头像控件搬进过面板，升级后要放回酒馆原位。
    只处理"还在我们面板里"的元素（没搬过就什么都不做）。 */
function chUnstickNatives() {
    const ids = ['favorite_button', 'advanced_div', 'world_button', 'char_connections_button', 'dupe_button',
        'create_button', 'create_button_label', 'delete_button', 'export_button', 'avatar_div_div', 'add_avatar_button'];
    const home = () => document.getElementById(CH_EDIT_ID) || document.getElementById('form_create') || document.body;
    const panel = document.getElementById('ssp_orb_panel');
    if (!panel) return false;
    let n = 0;
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!panel.contains(el)) return;
        if (id === 'avatar_div_div' || id === 'add_avatar_button') {
            const box = document.getElementById('avatar_div');
            if (box) { try { box.appendChild(el); n += 1; } catch (e) { } }
            return;
        }
        const host = home();
        if (host && !host.contains(el)) { try { host.appendChild(el); n += 1; } catch (e) { } }
    });
    return n > 0;
}
/** 点「保存/创建」：走酒馆自己的提交链（先 push，再**提交原生表单**）
    ⚠️ 不能用 `#create_button.click()` —— 实测它会**静默失败**：
       `#create_button` 是 `<input type=submit>`，但酒馆把它包在 `<label for="create_button">` 里，
       而我们的保存条所在的 `#rm_ch_create_block` 并不在 `<form id="form_create">` 内部
       → 它已经**不是表单所有者**了，点它不会触发 submit。
       e2e 实测：点击后 `/api/characters/edit` 一个请求都没发，卡数据原封不动（"保存了但没存上"）。
       所以改成自己派发 submit：会被酒馆的 jQuery 处理器接住（`$('#form_create').on('submit')`），
       而且 cancelable（没被 preventDefault 时默认动作本来也会提交表单）。 */
function chSave() {
    const form = document.getElementById('form_create');
    if (!form) { toast('找不到酒馆的写卡表单', 'warning'); return false; }
    /* 非静默：告诉用户"改动写回去了几处"（静默时用户会怀疑到底存没存） */
    let n = 0;
    try { n = chPush(false); } catch (e) { }
    try { chSyncTagChips(); } catch (e) { }
    try { chTagsRecollect(); } catch (e) { }        // 把用过的标签记进补全池
    let ok = false;
    try {
        ok = form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: false }));
    } catch (e) { ok = false; }
    if (!ok) {
        /* 兜底：万一有谁 preventDefault 了，就直接调酒馆自己的保存函数 */
        try {
            const ctx = getContext() || {};
            if (typeof ctx.createOrEditCharacter === 'function') { ctx.createOrEditCharacter({}); ok = true; }
            else if (ctx.model && typeof ctx.model.createOrEditCharacter === 'function') { ctx.model.createOrEditCharacter({}); ok = true; }
        } catch (e) { }
    }
    if (!ok) { toast('提交失败：酒馆没接住表单提交', 'warning'); return false; }
    chSay(n ? ('已把 ' + n + ' 处改动写回酒馆，正在保存…') : '没有要写的改动，直接保存…', 'ok');
    /* 保存是异步的（还要处理头像格式）→ 稍后再刷状态文字 + 清记账 */
    setTimeout(() => { try { chRefreshHead(); } catch (e) { } }, 900);
    setTimeout(() => {
        try { chRefreshHead(); } catch (e) { }
        try { chRefreshAvatars(); } catch (e) { }
        try { chRefreshSpecial(); } catch (e) { }
        try { chPanesClear(); } catch (e) { }        // 已进卡，不该再 push 一遍
    }, 2600);
    return true;
}
/** 顶栏"正在写：XX"（只刷文字，不重画） */
function chRefreshHead() {
    const el = sspTabRoot().querySelector('#ssp_orb_panel [data-chnow]');
    if (!el) return false;
    const form = document.getElementById('form_create');
    const act = form ? String(form.getAttribute('actiontype') || '') : '';
    const editing = (act === 'editcharacter');
    const nm = chVal('character_name_pole');
    el.innerHTML = editing ? ('正在写：<b>' + esc(nm || '(未命名)') + '</b>') : '新卡（还没保存）';
    return true;
}

/* ---------------- 原生 → 我的：酒馆自己改了字段时跟着刷 ---------------- */
let chBindOnce = false;
let chPushing = false;          // 正在 push：这期间原生派发的事件不理会
let chDirty = {};               // 被用户改过的原生 id（push 只看这些）
let chCache = {};               // 上次 pull 时原生元素的值（原生自己变了才回填我的框）

function chBindNativeOnce() {
    if (chBindOnce) return true;
    /* ⚠️ 事件挂在**面板**上（不是写卡页的分页上）—— 它管的不只是那 16 个字段：
       选卡页的"分组"输入框、备选开场白列表的正文/分组，都靠这里的事件委托。
       原来只在"进过写卡页"时才绑 → **直接进选卡页改分组完全没反应**（e2e 抓到）。
       所以改成由 bindOrb 在挂载时就绑，不依赖有没有进过写卡页；这里保留重试。 */
    const g = sspPanelEl();
    if (!g) return false;
    chBindOnce = true;
    try {
        /* 我的输入 → 立刻写回原生（这样即使酒馆用"读 DOM"的方式取值也不会读到旧的） */
        const onMine = (ev) => {
            /* ---- 选卡页：卡的分组输入框（只认 change＝敲完/失焦，免得每敲一个字就重画列表） ---- */
            const evT = (ev.composedPath && ev.composedPath()[0]) || ev.target;
            const ci = evT && evT.closest ? evT.closest('[data-ccardgrpin]') : null;
            if (ci) {
                if (ev.type === 'change') {
                    chCardSetGroup(ci.dataset.ccardgrpin, ci.value);
                    chCardEdit = '';
                    try { renderOrbPanel(); } catch (e) { }
                }
                return;
            }
            const el = evT && evT.closest ? evT.closest('[data-chk]') : null;
            /* ---- 备选开场白列表里的两格（它们不在 VAULT_SCHEMA 里，单独接） ---- */
            if (!el) {
                const gt2 = evT && evT.closest ? evT.closest('[data-chgtext]') : null;
                if (gt2) { chGreetSetText(Number(gt2.dataset.chgtext), gt2.value); chGreetDirty = true; return; }
                const gg = evT && evT.closest ? evT.closest('[data-chggroup]') : null;
                if (gg) {
                    chGreetSetGroup(Number(gg.dataset.chggroup), gg.value);
                    chGreetDirty = true;
                    chGreetRowsRender();                          // 只换行列表：不打断这一格的输入
                    chGreetChipsRender();                         // 刷新筛选条与候选
                    return;
                }
                return;
            }
            const id = el.dataset.chid;
            if (id) chDirty[id] = 1;
            if (id) {
                const nat = document.getElementById(id);
                if (nat) {
                    const v = String(el.value == null ? '' : el.value);
                    if (nat.value !== v) {
                        chPushing = true;
                        try { nat.value = v; } catch (e) { }
                        chPushing = false;
                    }
                }
            }
            if (el.dataset.chk === 'tags') { try { chSyncTagChips(); } catch (e) { } }
            try { chCount(); } catch (e) { }
            if (id === 'character_name_pole') { try { chRefreshHead(); } catch (e) { } }
        };
        /* ⚠️ 绑 **document**（捕获）而不是面板元素：写卡页现在渲染在影子根里，
           影子里的 input 事件不会经过面板元素（跨 shadow 边界），绑在面板上就永远收不到。
           onMine 里已经用 composedPath()[0] 取真实目标，不匹配就早退，挂 document 没有额外开销。 */
        document.addEventListener('input', onMine, true);
        document.addEventListener('change', onMine, true);
        /* 原生 → 我的：酒馆回填（切卡 / 新建 / 导入 / 选头像 / 点高级定义）时把值抄回来。
           ⚠️ 只在**原生那侧的值真的变了**才抄，否则会把用户正在打的字盖掉。 */
        const onNative = (ev) => {
            if (chPushing) return;
            const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
            if (!el || !el.id) return;
            const f = chFldById(el.id);
            if (f) {
                const v = String(el.value == null ? '' : el.value);
                if (chCache[el.id] === v) return;
                chCache[el.id] = v;
                const mine = chMine(f.k);
                if (mine && mine.value !== v) mine.value = v;
                try { chCount(); } catch (e) { }
                if (el.id === 'character_name_pole') { try { chRefreshHead(); } catch (e) { } }
            } else if (el.id === 'character_world') {
                try { chRefreshSpecial(); } catch (e) { }
            } else if (el.id === 'avatar_load_preview') {
                try { chRefreshAvatars(); } catch (e) { }
            } else if (el.id === 'fav_checkbox') {
                try { chSyncFav(); } catch (e) { }
            }
        };
        document.addEventListener('input', onNative, true);
        document.addEventListener('change', onNative, true);
        /* ⚠️ 保存前的最后一道保险：捕获阶段一定早于 jQuery 的委托处理
           （`$('#form_create').on('submit', …)`），见文件头第 2 条 */
        document.addEventListener('submit', (ev) => {
            const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
            if (t && t.id === 'form_create') { try { chPush(true); } catch (e) { } }
        }, true);
        document.addEventListener('click', (ev) => {
            const t = ev.target && ev.target.closest ? ev.target.closest('#create_button, #create_button_label') : null;
            if (t) { try { chPush(true); } catch (e) { } }
        }, true);
        return true;
    } catch (e) {
        try { sspPushErr('vault-bind', e && e.message); } catch (e2) { }
        return false;
    }
}

/* ---------------- 原生框子：藏着但留在文档里 ----------------
   ⚠️ **一个原生元素都不搬**（v1.31.52 的硬规矩）。

   历史教训（值得留在这，别再犯）：
     v1.31.50~51 我们把酒馆那排小按钮（收藏/高级/世界书/导出/复制/删除）和头像控件
     **搬进**面板的保存条里。结果用户看到的是：
       · 「找不到酒馆的按钮：favorite_button」——点了没反应；
       · 过一会儿 ★ 直接不见了。
     原因是**酒馆会重建写卡块和它的按钮容器**：我们搬走的那几颗，在"面板重画 + 原来那个家
     已经脱链"的那一刻就成了孤儿（不在文档里）。再往后 getId 拿到的是尸体，点了当然"找不到"。

   现在的做法（简单而且不会坏）：
     · 原生按钮**待在酒馆自己的位置上**，我们只用一张注入的样式表把它们**藏起来**（位置不动、关系不断）；
     · 面板里的图标全是**我们自己画的**，点下去用 chNative(id) **隔空点**那颗原生按钮；
     · 于是"孤儿"这个 bug 类别彻底不存在了。

   藏哪些：见 CH_PIN_SEL。放开：面板一关整张样式表撤掉（原生立刻原样可见）。
   ------------------------------------------------------------------ */

/** 开写卡页：把**两个浮层**藏掉（高级定义 / 世界书选择器），并把常用的原生按钮搬进工具条。
    ⚠️ **绝不藏 `#rm_ch_create_block` / `#form_create`** —— 那等于把酒馆自己的角色编辑界面
       弄没了（用户实测反馈过："我酒馆原生的角色卡界面什么都没有了"）。
       我们只在面板里显示自己的界面，原生那份原样留在酒馆的右侧抽屉里，随时能用。
    ⚠️ 还要能"自愈"：酒馆会在多个流程里重画/换父容器，那排按钮可能是新节点。 */
function chMountFrame() {
    try {
        /* ⚠️ 先判"现在到底该不该钉"：面板开着 **且** 停在写卡页。
           少了这一条会出这个坑：面板关了之后，观察者/轮询还在跑，又把 `#character_popup` 钉回去
           → 酒馆自己的「高级定义」就永远打不开了（用户会看到"原生界面没了"）。 */
        if (!orbOpenNow || orbTab !== 'editor') { try { chUnmountFrame(); } catch (e) { } return false; }
        /* 只藏**高级定义弹窗** `#character_popup`：它本来就是 `position:absolute; display:none` 的浮层，
           我们把它搬进面板里当字段宿主，所以要保证它不在原地冒出来。
           ⚠️ 世界书那两个（`#WorldInfo` / `#world_popup`）**不在这里常驻钉**：
              它们由 chOverlay() 在"用户真的要选世界书"时按需搬进面板、关掉就还回去；
              常驻钉住会让它们在外面的状态变得莫名其妙（实测：关面板后还 pin 着）。 */
        chPin(document.getElementById(CH_POPUP_ID), true);
        /* 写卡块**永远不该**出现在我们的面板里（这一版不搬 DOM；出现了就是哪里漏了） */
        const block = document.getElementById(CH_EDIT_ID);
        if (block && block.closest && block.closest('#ssp_orb_panel')) {
            try { chUnstickNatives(); } catch (e) { }
        }
        /* ⚠️ 这里以前会把"头像控件 / 原生那排小按钮"搬进面板 —— **已经全部取消**。
           原因：酒馆会重建写卡块与按钮容器，搬走的东西在"面板重画 + 原家已脱链"时会变成孤儿，
           用户看到的就是"找不到酒馆的按钮 / 星星不见了"。
           现在原生按钮**一样都不搬**，只靠上面的 pin 样式表把它们藏起来（位置不动、关系不断），
           我们的按钮用 chNative() 隔空点它们。 */
        return true;
    } catch (e) { return false; }
}
/** 关写卡页 / 关面板：放开隐藏 + 把借走的按钮还回去。
    ⚠️ 这一趟必须**真的把 pin 全放开**：`#character_popup` 被我们钉住＝**酒馆原生的「高级定义」打不开了**
       （用户会看到"原生的界面没了"）。所以除了逐个放，末尾还有一次**兜底全清**。 */
function chUnmountFrame() {
    try { chOverlayClose(); } catch (e) { }
    /* 离开写卡页先把改动落回原生，免得"看着改了其实没进表单" */
    try { chPush(true); } catch (e) { }
    try {
        document.querySelectorAll('[data-ssp-ch-pin]').forEach(el => { try { chPin(el, false); } catch (e) { } });
    } catch (e) { }
    try { chPinSheet(false); } catch (e) { }        // 兜底：整张样式表撤掉
    try {
        document.querySelectorAll('[data-ssp-ch-pin]').forEach(el => { try { delete el.dataset.sspChPin; } catch (e) { } });
    } catch (e) { }
    /* 不再有"搬回去"这一步（我们不搬任何原生元素了）。
       但**旧版本可能已经把按钮搬走过** → 这里做一次一次性归位，防止升级后按钮卡在面板里。 */
    try { chUnstickNatives(); } catch (e) { }
    return true;
}

/** 酒馆的世界书选择器是**点开才插进 DOM** 的 → 挂着观察，插进来就钉掉（用我们自己的浮层看）。
    顺带治一个实测到的"自己会冒出来"：酒馆**打开右侧抽屉**（`#right-nav-panel.openDrawer`）
    时会用 `.right_menu` 的显示规则把 `#rm_ch_create_block` 弄回 display:block，
    而那条规则不是内联样式 → 我们的 pin 挡不住它，写卡块会盖在我们的面板上（手机实测：
    `elementFromPoint` 命中的是它）。所以抽屉一开就**补钉一次**（幂等、很便宜）。 */
let chObs = null;
function chBindOverlayWatch() {
    if (chObs || !window.MutationObserver) return false;
    try {
        chObs = new MutationObserver(() => {
            /* ⚠️ **必须防抖**：这个观察挂在 body 的 subtree + class/style 上，
               而 chMountFrame 本身会动 DOM（搬按钮、设 data 属性）→ 不防抖就会自己喂自己，
               实测直接把页面卡死（e2e 3 分钟不返回）。 */
            if (chObs.t) return;
            chObs.t = setTimeout(() => {
                chObs.t = 0;
                try {
                    chMountFrame();                 // 内部会自己判断"该不该钉"
                } catch (e) { }
            }, 150);
        });
        chObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        /* 兜底轮询：MutationObserver 有时机漏网（实测"切走再切回来"这一趟就漏）。
           很便宜（就是几个 getElementById + 读写一个 data 属性），只在写卡页开着时跑。 */
        if (!chObs.timer) {
            chObs.timer = setInterval(() => {
                try {
                    if (orbOpenNow && orbTab === 'editor') chMountFrame();
                } catch (e) { }
            }, 700);
        }
        return true;
    } catch (e) { return false; }
}

/* 快捷按钮托盘（v1.31.56 新增）
   用户要的：「在输入框上方做成悬浮按钮，一个是回底一个是重新发送，外观自己设计，
             做接口连接到原生按键（回底没有原生按键可以直接做，重新发送有），
             这几个按钮都可以随意开关」。
   定下来的四条（用户选的）：玻璃药丸外观 / 只做这两个但**留槽** / 一直显示 / 重新发送转发原生那颗。

   设计要点：
   · **一张表驱动**（QUICK_BUTTONS）：加按钮只加一行，设置面板里的开关会自动出现；
   · 两种类型：`native` = 转发酒馆原生那颗（点它，不另造逻辑）；`run` = 自己实现（回底就走这条）；
   · 挂在 body 上（fixed），跟悬浮球一样**不进面板的 DOM**，所以面板重画不会把它弄没；
   · 位置按 `#send_form` 的**实时位置**算（输入框会随字数长高），配 ResizeObserver + resize + 轮询兜底；
   · 只在**聊天页可见**时显示（切到角色管理/API 那些页面就藏起来，不然会飘在别的东西上）。 */
const QUICK_BAR_ID = 'ssp_quickbar';

/** 按钮表：id / 名字 / 图标 / 提示 / 类型
     - `native: '某id或选择器'` → 点酒馆原生那颗（走 chNativeEl 那套查找）
     - `run: fn`                → 自己实现
    默认全开（`def: false` 才会默认关）。以后加按钮往这里加一行即可。 */
const QUICK_BUTTONS = [
    {
        id: 'bottom', name: '回底', icon: 'fa-arrow-down-long',
        hint: '滚到最新一条。自己直接滚 #chat —— 不依赖酒馆那个"自动滚到底"设置（那个关掉时酒馆自带的函数会直接 return）',
        run: () => qbScrollBottom(),
    },
    {
        id: 'resend', name: '重新发送', icon: 'fa-rotate-right',
        hint: '转发酒馆原生的「重新生成」：最后一条是 AI 就重新生成它，是你的消息就相当于再发一次',
        native: 'option_regenerate',
    },
    /* v1.31.83：用户要的另外两个原生项。**只点原生元素、不搬 DOM** ——
       删除消息走酒馆自己的删除框（选哪条删哪条），新聊天走它自己的逻辑。
       两个都是破坏性动作，所以 def:false（默认不上托盘，要用自己在常用开关里打开）。 */
    {
        id: 'startnew', name: '新聊天', icon: 'fa-comments', hint: '等同于酒馆「选项 → 开始新聊天」：给当前角色开一份新聊天，现在这份留在存档里',
        native: 'option_start_new_chat', def: false,
    },
    {
        id: 'delmes', name: '删除消息', icon: 'fa-trash-can', hint: '等同于酒馆「选项 → 删除消息」：打开酒馆自己的删除框，选哪条删哪条',
        native: 'option_delete_mes', def: false,
    },
];

/** 可选的锚点（顺序就是下拉里的顺序） */
const QB_ANCHORS = ['send', 'form-right', 'form-center', 'form-left', 'viewport-right'];
const QB_ANCHOR_NAME = {
    'send': '发送按钮上方（跟着发送键）',
    'form-right': '输入框上方 · 靠右',
    'form-center': '输入框上方 · 居中',
    'form-left': '输入框上方 · 靠左',
    'viewport-right': '贴浏览器右下角',
};

/** 托盘设置（归一化，读的时候顺手补默认值） */
function quickBarSettings() {
    const s = getSettings();
    if (!s.quickBar || typeof s.quickBar !== 'object') s.quickBar = {};
    const q = s.quickBar;
    if (typeof q.on !== 'boolean') q.on = true;
    /* 锚点：托盘横向挂在哪
         · 'send'           = 右对齐**发送按钮**（默认，用户要的：跟着发送键走，不会飘到跟输入区无关的地方）
         · 'form-right' / 'form-center' / 'form-left' = 对齐输入框的右/中/左
         · 'viewport-right' = 老的"贴浏览器右下角"
       ⚠️ 老版本存的是 q.align（left/center/right）——这里**直接弃用**：用户明确说"默认改成发送按钮"。
          想回旧位置，在新下拉里选一下即可（位置都还在）。 */
    if (QB_ANCHORS.indexOf(q.anchor) < 0) q.anchor = 'send';
    if (q.align !== undefined) delete q.align;
    if (typeof q.size !== 'number' || !isFinite(q.size)) q.size = 34;
    if (typeof q.radius !== 'number' || !isFinite(q.radius)) q.radius = 10;
    if (typeof q.opacity !== 'number' || !isFinite(q.opacity)) q.opacity = 0.82;
    if (typeof q.gap !== 'number' || !isFinite(q.gap)) q.gap = 5;
    if (typeof q.offset !== 'number' || !isFinite(q.offset)) q.offset = 10;
    if (!q.btns || typeof q.btns !== 'object') q.btns = {};
    QUICK_BUTTONS.forEach(b => { if (typeof q.btns[b.id] !== 'boolean') q.btns[b.id] = (b.def !== false); });
    return q;
}
/** 当前要显示哪几个按钮（顺序跟表一致） */
function qbList() {
    const q = quickBarSettings();
    return QUICK_BUTTONS.filter(b => q.btns[b.id] !== false);
}
/** 托盘本体（玻璃药丸）：按钮全是我们自己画的 */
function qbHTML() {
    const q = quickBarSettings();
    const list = qbList();
    const btns = list.map(b => '<span class="ssp-qb" data-ssp-qb="' + esc(b.id) + '" title="' + esc(b.name + '：' + b.hint) + '">'
        + '<i class="fa-solid ' + b.icon + '"></i>'
        + (q.showLabel ? '<b>' + esc(b.name) + '</b>' : '') + '</span>').join('');
    return btns || '<span class="ssp-qb-empty">没有开启的按钮</span>';
}
/** 建/更新托盘：挂在 body 上（不进面板 DOM，面板重画不会弄丢） */
function qbMount() {
    try {
        const q = quickBarSettings();
        let el = document.getElementById(QUICK_BAR_ID);
        if (!q.on || !qbList().length) { if (el) el.remove(); return false; }
        if (!el) {
            el = document.createElement('div');
            el.id = QUICK_BAR_ID;
            el.className = 'ssp-qb-root';          // ⚠️ 两个 class 是为了压过主题那条 `*:not(#chat…)` 的圆角 !important
            el.setAttribute('role', 'toolbar');
            el.setAttribute('aria-label', '快捷按钮托盘');
            document.body.appendChild(el);
        }
        const html = qbHTML();
        if (el.dataset.sspQbSig !== html) { el.innerHTML = html; el.dataset.sspQbSig = html; }
        /* 外观变量（都在设置面板里可调） */
        el.style.setProperty('--qb-size', Math.round(q.size) + 'px');
        el.style.setProperty('--qb-radius', Math.round(q.radius) + 'px');
        el.style.setProperty('--qb-op', String(Math.max(0.15, Math.min(1, q.opacity))));
        el.style.setProperty('--qb-gap', Math.round(q.gap) + 'px');
        el.dataset.sspQbAlign = q.align;
        qbPlace();
        return true;
    } catch (e) { try { sspPushErr('quickbar', e && e.message); } catch (e2) { } return false; }
}
/** 位置：贴着输入框**上沿**（输入框会随字数长高，所以要实时算） */
function qbPlace() {
    try {
        const el = document.getElementById(QUICK_BAR_ID);
        if (!el) return false;
        const q = quickBarSettings();
        const chat = document.getElementById('chat');
        const form = document.getElementById('send_form');
        /* 只在"聊天页真的看得见"时显示：切到角色管理 / API 那些页面时 #chat 没盒子 → 藏起来
           （不然托盘会飘在角色列表上，很怪） */
        const chatVisible = !!(chat && chat.getClientRects().length);
        const formVisible = !!(form && form.getClientRects().length);
        if (!chatVisible) { el.style.display = 'none'; return false; }
        el.style.display = 'flex';
        /* 纵向：贴着输入区的**上沿**（输入框会随字数长高，所以每次实时算）。
           取 form 和发送按钮里更靠上的那个 → 保证既不盖输入框、也不盖发送键。 */
        const but = document.getElementById('send_but');
        const butVisible = !!(but && but.getClientRects().length);
        const fr = formVisible ? form.getBoundingClientRect() : null;
        const br = butVisible ? but.getBoundingClientRect() : null;
        const topY = (fr && br) ? Math.min(fr.top, br.top) : (fr ? fr.top : (br ? br.top : null));
        if (topY !== null) {
            el.style.bottom = Math.round(Math.max(0, window.innerHeight - topY + q.offset)) + 'px';
        } else {
            el.style.bottom = Math.round(q.offset + 60) + 'px';    // 兜底：找不到输入框时别贴死底部
        }

        /* 横向：按锚点算 left，最后**统一夹进视口**（避免算出负数或被右边缘截掉） */
        const vw = window.innerWidth;
        const w = el.offsetWidth || 84;
        /* v1.31.58：内缩从 10px 改成 2px —— **手机上没连 API 时输入框本来就贴到屏幕边**（实测 390 宽时
           输入框右边=390、发送键右边=387），原来留 10px 内缩会把托盘往里推 7~10px，
           "贴着发送键"看着就不贴了（手机版 e2e 直接量出来 380 vs 387）。现在只在**要出屏幕**时才夹。 */
        const pad = 2;
        const anchor = q.anchor;
        let leftX = null;
        /* 发送按钮不可见时（没连 API 等）→ 按用户定的退到"输入框右边缘" */
        const refRight = (anchor === 'send' && !butVisible && fr) ? fr.right
            : (anchor === 'send' && br) ? br.right : null;
        if (anchor === 'send') {
            if (refRight !== null) leftX = refRight - w;              // 右对齐参照物的右边缘
            else if (fr) leftX = fr.right - w;                        // 连输入框都没有 → 也别掉到视口边去
        } else if (anchor === 'form-right' && fr) leftX = fr.right - w;
        else if (anchor === 'form-center' && fr) leftX = fr.left + fr.width / 2 - w / 2;
        else if (anchor === 'form-left' && fr) leftX = fr.left;
        if (leftX === null) leftX = vw - w - pad;                     // 'viewport-right' 或什么都量不到时的兜底
        leftX = Math.max(pad, Math.min(vw - w - pad, leftX));
        el.style.left = Math.round(leftX) + 'px';
        el.style.right = 'auto';
        el.style.transform = 'none';
        /* ⚠️ 最后一关：**被别的面板盖住就藏起来**。
           光看"#chat 有没有盒子"不够：手机上打开右侧抽屉（角色列表）时聊天区还在、只是被盖住了，
           托盘会浮在抽屉上面显得很怪；而桌面端抽屉未必盖住输入框，那时就该继续显示。
           用 elementFromPoint 在托盘中心探一下"最上层是不是我自己"，两种情况都照顾到。
           （同一帧内先设成 flex、量完再决定，浏览器只在最后绘制，不会闪。） */
        try {
            const r2 = el.getBoundingClientRect();
            const cx = Math.round(r2.left + r2.width / 2), cy = Math.round(r2.top + r2.height / 2);
            const top = document.elementFromPoint(cx, cy);
            const mineTop = !!(top && (top === el || el.contains(top)));
            if (!mineTop) { el.style.display = 'none'; return false; }
        } catch (e) { }
        return true;
    } catch (e) { return false; }
}
/** 回底：自己滚（酒馆自带的 scrollChatToBottom 在"自动滚到底"关掉时会直接 return，靠不住） */
function qbScrollBottom() {
    try {
        const c = document.getElementById('chat');
        if (!c) { toast('找不到聊天区（#chat）', 'warning'); return false; }
        const top = c.scrollHeight;
        try { c.scrollTo({ top: top, behavior: 'smooth' }); }
        catch (e) { c.scrollTop = top; }
        return true;
    } catch (e) { return false; }
}
/** 跑一个按钮：native → 转发原生那颗；run → 自己实现 */
function qbRun(id) {
    const b = QUICK_BUTTONS.find(x => x.id === id);
    if (!b) return false;
    if (b.native) {
        const el = chNativeEl(b.native);
        if (!el) { toast('找不到酒馆的按钮：' + b.native, 'warning'); return false; }
        try { el.click(); } catch (e) { toast('触发失败：' + (e && e.message), 'warning'); return false; }
        return true;
    }
    if (typeof b.run === 'function') { try { return b.run() !== false; } catch (e) { toast('执行失败：' + (e && e.message), 'warning'); return false; } }
    return false;
}
/** 绑事件（只绑一次）+ 位置跟随 */
function qbBind() {
    if (qbBind.done) return false;
    qbBind.done = true;
    document.addEventListener('click', ev => {
        const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        const hit = t && t.closest ? t.closest('[data-ssp-qb]') : null;
        if (!hit) return;
        ev.stopPropagation();
        qbRun(hit.dataset.sspQb);
    }, true);
    /* 位置跟随：窗口尺寸、输入框长高（ResizeObserver）、以及一个很轻的轮询兜底
       （酒馆切页面/切聊天会换布局，事件不一定齐） */
    globalThis.addEventListener?.('resize', () => qbPlace());
    try {
        if (window.ResizeObserver) {
            const form = document.getElementById('send_form');
            if (form) { new ResizeObserver(() => qbPlace()).observe(form); qbBind.obs = true; }
        }
    } catch (e) { }
    try {
        if (!qbBind.timer) qbBind.timer = setInterval(() => { try { qbPlace(); } catch (e) { } }, 1200);
    } catch (e) { }
    return true;
}

/* ============================ 选卡（找一张卡出来写 / 管）============================
   为什么不把整块 `#rm_characters_block` 搬进来（想过，结论是别搬）：
     · 那块不只是列表 —— 搜索框、标签筛选条、分页、批量编辑、新建/导入/URL导入这一排按钮
       **全在里面**，工坊 BUTTONS 表 22 个按钮有 14 个的选择器落在它上面；整块搬走 =
       把工坊的"使用态"一起搬走，而工坊工作台（.ssp_box）又挂在它顶部的 #charListFixedTop 里，
       两个浮层同时开必然互相打架。
     · 分页 / 标签筛选 / 拖拽排序深度依赖酒馆自己的代码（printCharacters 重画那个容器、
       CHARACTER_FILTER_SELECTOR 填标签）→ 在口袋里重画一份 = 第二套渲染器，酒馆一更新就得修两遍。
   所以这里只做**只读的选卡器**：搜索 + 头像墙 + 点一下＝打开它去写卡。重管理仍然回原生列表。
   ========================================================================== */
var orbPickSearch = '';          // 选卡器的搜索词（纯内存，不落设置 —— 跟其它页签的搜索一致）
let orbPickMode = 'recent';      // recent（最近写过/用过）| all（全部）| fav（收藏）
let orbPickView = 'list';        // list（一条一行，能排序 / 分组）| grid（头像墙）
let orbPickGroup = '';           // 分组筛选：'' = 全部；'__none__' = 未分组
let chCardEdit = '';             // 正在改分组的那张卡（头像文件名；'' = 没有）

/* ---------------- 卡分组（存扩展设置里，**不动用户的卡文件**） ----------------
   为什么不像开场白那样写进卡里：卡没有"自定义分组"这个字段，塞进去等于污染卡数据；
   而分组本来就是"我这台机器上怎么摆"，放设置里最合适。
   设置键：`sspCardGroups` = { 头像文件名: 组名 }。 */
function chCardGroups() {
    try {
        const s = getSettings();
        if (!s.sspCardGroups || typeof s.sspCardGroups !== 'object') s.sspCardGroups = {};
        return s.sspCardGroups;
    } catch (e) { return {}; }
}
function chCardGroupOf(c) {
    const av = c && c.avatar;
    if (!av) return '';
    return String(chCardGroups()[av] || '').trim();
}
function chCardSetGroup(avatar, grp) {
    try {
        const av = String(avatar || '').trim();
        if (!av) return false;                       // ⚠️ 空头像名绝不写（会把所有卡挤到同一个空键上）
        const m = chCardGroups();
        delete m[''];                                // 顺手清掉早期踩坑留下的空键
        const g = String(grp || '').trim();
        if (g) m[av] = g; else delete m[av];
        save();
    } catch (e) { return false; }
    return true;
}
/** 用过的分组名（去重、按出现顺序） */
function chCardGroupNames() {
    const m = chCardGroups();
    const out = [];
    Object.keys(m).forEach(k => { const v = String(m[k] || '').trim(); if (v && out.indexOf(v) < 0) out.push(v); });
    return out;
}
/** 分组筛选：'__none__' 表示"未分组" */
function chCardInPick(c) {
    if (!orbPickGroup) return true;
    const g = chCardGroupOf(c);
    return orbPickGroup === '__none__' ? !g : g === orbPickGroup;
}
/** 上移/下移一张卡：动的是 `cardOrder`（扩展自己的顺序表；工坊的"手动排序"也写这个）。
    `list` = 当前屏幕上这个顺序（可能被筛过），交换要落到**完整顺序表**里。 */
function chCardMove(avatar, dir, list) {
    try {
        const s = getSettings();
        const idx = (list || []).findIndex(c => c.avatar === avatar);
        if (idx < 0) return false;
        const nb = list[idx + dir];
        if (!nb) return false;
        const order = Array.isArray(s.cardOrder) ? s.cardOrder.slice() : [];
        orbRecentCards().map(c => c.avatar).forEach(a => { if (order.indexOf(a) < 0) order.push(a); });
        const i = order.indexOf(avatar), j = order.indexOf(nb.avatar);
        if (i < 0 || j < 0) return false;
        const t = order[i]; order[i] = order[j]; order[j] = t;
        s.cardOrder = order;
        save();
        try { applyCardOrder(); } catch (e) { }          // 让酒馆原生列表也跟着这个顺序
        chPickSave();
        return true;
    } catch (e) { return false; }
}
/** 选卡页改动后重画（保留滚动位置由 renderOrbPanel 负责） */
function chPickSave() {
    try { renderOrbPanel(); } catch (e) { return false; }
    return true;
}
/** 当前屏幕上那张列表（跟 orbPickHTML 里的筛选口径**必须一致**，否则上移下移会跳错邻居）。
    有了它，chCardMove 才知道"上一条"是谁。 */
function chPickCurList() {
    const all = orbCardsList();
    const q = orbPickSearch.trim().toLowerCase();
    let list = (orbPickMode === 'fav')
        ? all.filter(c => c.fav === true || c.fav === 'true')
        : (orbPickMode === 'all' ? all : orbRecentCards());
    if (q) {
        list = list.filter(c => (String(c.name).toLowerCase().indexOf(q) >= 0)
            || orbCardTags(c).some(t => String(t).toLowerCase().indexOf(q) >= 0));
    }
    return list.filter(chCardInPick);
}

function orbCardsList() {
    try {
        const cs = (getContext() || {}).characters;
        return Array.isArray(cs) ? cs.filter(c => c && c.name) : [];
    } catch (e) { return []; }
}
/** 头像地址：酒馆静态路径 /characters/<文件>（扩展里「数据」页也是这么拿的） */
function orbCardAvatarUrl(c) {
    if (!c || !c.avatar || c.avatar === 'none') return '';
    if (/^(data:|https?:|blob:)/i.test(c.avatar)) return c.avatar;
    return '/characters/' + encodeURIComponent(c.avatar);
}
function orbCardTags(c) {
    const t = c && c.data && c.data.tags;
    return Array.isArray(t) ? t.filter(Boolean).slice(0, 3) : [];
}
/** 最近写过/用过的顺序：先看扩展自己的顺序表，再看酒馆的 date_last_chat */
function orbRecentCards() {
    const all = orbCardsList();
    const s = getSettings();
    const order = Array.isArray(s.cardOrder) ? s.cardOrder : [];
    const rank = new Map();
    order.forEach((a, i) => { if (!rank.has(a)) rank.set(a, i); });
    return all.slice().sort((a, b) => {
        const ra = rank.has(a.avatar) ? rank.get(a.avatar) : 1e9;
        const rb = rank.has(b.avatar) ? rank.get(b.avatar) : 1e9;
        if (ra !== rb) return ra - rb;
        return Number(b.date_last_chat || 0) - Number(a.date_last_chat || 0);
    });
}

/** 头像墙那一格（原来的样子，保留给"墙"视图） */
function orbCardRowHTML(c) {
    const url = orbCardAvatarUrl(c);
    const tags = orbCardTags(c);
    const fav = c.fav === true || c.fav === 'true';
    const editing = (() => {
        const id = (getContext() || {}).characterId;
        const cur = orbCardsList()[id];
        return !!(cur && cur.avatar === c.avatar);
    })();
    return '<div class="ssp-ch-card' + (editing ? ' on' : '') + '" data-orb-chpick="' + esc(c.avatar || c.name) + '">'
        + '<div class="ssp-ch-av">' + (url ? '<img src="' + esc(url) + '" loading="lazy" decoding="async" alt="">' : '<i class="fa-solid fa-user"></i>') + '</div>'
        + '<div class="ssp-ch-meta"><b>' + esc(c.name) + (fav ? ' <i class="fa-solid fa-star ssp-ch-fav"></i>' : '') + '</b>'
        + (tags.length ? '<span class="ssp-ch-tags">' + tags.map(t => esc(t)).join(' · ') + '</span>' : '')
        + '</div></div>';
}

/** 列表视图的一行：头像 + 名字 + 分组 + 排序/分组按钮 —— 手机上这行比头像墙省地方得多。
    ⚠️ 行的 key（`data-chcard` / `data-ccard*`）必须是 **`c.avatar`**，不能是 `c.avatar || c.name`：
       头像缺省时用名字当 key，会让"分组"这类**按头像存的数据**全部落到同一个空键上
       （实测：把所有卡的组名都写成同一个值，读回来全空）。名字只用来显示。 */
function orbCardListRowHTML(c) {
    const url = orbCardAvatarUrl(c);
    const fav = c.fav === true || c.fav === 'true';
    const grp = chCardGroupOf(c);
    const editing = (() => {
        const id = (getContext() || {}).characterId;
        const cur = orbCardsList()[id];
        return !!(cur && cur.avatar === c.avatar);
    })();
    const av = esc(String(c.avatar || ''));
    return '<div class="ssp-ch-grow' + (editing ? ' on' : '') + '" data-chcard="' + av + '">'
        + '<div class="ssp-ch-cardrow">'
        + '<span class="ssp-ch-cav" data-orb-chpick="' + av + '">'
        + (url ? '<img src="' + esc(url) + '" loading="lazy" decoding="async" alt="">' : '<i class="fa-solid fa-user"></i>')
        + '</span>'
        + '<span class="ssp-ch-cname" data-orb-chpick="' + av + '"><b>' + esc(c.name) + '</b>'
        + (fav ? ' <i class="fa-solid fa-star ssp-ch-fav"></i>' : '') + '</span>'
        + (grp ? '<span class="ssp-ch-gtag">' + esc(grp) + '</span>' : '')
        + '<span class="ssp-ch-gops">'
        + '<span class="ssp-pbtn ssp-ch-mini ssp-ch-icon" data-ccardup="' + av + '" title="上移"><i class="fa-solid fa-chevron-up"></i></span>'
        + '<span class="ssp-pbtn ssp-ch-mini ssp-ch-icon" data-ccarddown="' + av + '" title="下移"><i class="fa-solid fa-chevron-down"></i></span>'
        + '<span class="ssp-pbtn ssp-ch-mini ssp-ch-icon" data-ccardgrp="' + av + '" title="设置分组"><i class="fa-solid fa-folder"></i></span>'
        + '</span></div></div>';
}

/** 点「分组」图标后，行下面长出来的输入框 */
function orbCardGroupEditorHTML(avatar, c) {
    const grp = chCardGroupOf(c);
    const names = chCardGroupNames();
    return '<div class="ssp-ch-ggedit"><datalist id="ssp_ch_cgroups">'
        + names.map(n => '<option value="' + esc(n) + '"></option>').join('')
        + '</datalist>'
        + '<label class="ssp-ch-grow2"><span>分组</span>'
        + '<input class="ssp-inp" type="text" list="ssp_ch_cgroups" data-ccardgrpin="' + esc(avatar) + '"'
        + ' value="' + esc(grp) + '" placeholder="（留空＝未分组）如：剧情 / 工具 / 测试">'
        + '</label>'
        + '<div class="ssp-ch-hint">分组只是这台机器上的摆放方式，不写进卡文件（换机器不会跟着走）。</div>'
        + '</div>';
}

function orbPickHTML() {
    const all = orbCardsList();
    const q = orbPickSearch.trim().toLowerCase();
    let list = (orbPickMode === 'fav')
        ? all.filter(c => c.fav === true || c.fav === 'true')
        : (orbPickMode === 'all' ? all : orbRecentCards());
    if (q) {
        list = list.filter(c => (String(c.name).toLowerCase().indexOf(q) >= 0)
            || orbCardTags(c).some(t => String(t).toLowerCase().indexOf(q) >= 0));
    }
    const total = list.length;
    list = list.filter(chCardInPick);
    const groups = chCardGroupNames();
    const ungrouped = (orbPickMode === 'all' ? all : orbRecentCards()).filter(c => !chCardGroupOf(c)).length;
    const chips = ['<span class="ssp-ch-chip' + (orbPickGroup ? '' : ' on') + '" data-ccardpick="">全部</span>']
        .concat(groups.map(g => '<span class="ssp-ch-chip' + (orbPickGroup === g ? ' on' : '') + '" data-ccardpick="' + esc(g) + '">' + esc(g) + '</span>'))
        .concat(ungrouped ? ['<span class="ssp-ch-chip' + (orbPickGroup === '__none__' ? ' on' : '') + '" data-ccardpick="__none__">未分组</span>'] : [])
        .join('');
    const head = '<div class="ssp-orb-pfilter">'
        + '<input class="ssp-inp" type="text" data-orb-picksearch="1" placeholder="搜角色名 / 标签" value="' + esc(orbPickSearch) + '">'
        + (orbPickSearch ? '<span class="ssp-pbtn" data-orb-pickclear="1">清除</span>' : '')
        + '</div>'
        + '<div class="ssp-orb-pfilter ssp-ch-modes">'
        + '<span class="ssp-pbtn' + (orbPickMode === 'recent' ? ' primary' : '') + '" data-orb-pickmode="recent">最近</span>'
        + '<span class="ssp-pbtn' + (orbPickMode === 'fav' ? ' primary' : '') + '" data-orb-pickmode="fav">收藏</span>'
        + '<span class="ssp-pbtn' + (orbPickMode === 'all' ? ' primary' : '') + '" data-orb-pickmode="all">全部</span>'
        + '<span class="ssp-sp"></span>'
        + '<span class="ssp-pbtn' + (orbPickView === 'list' ? ' primary' : '') + '" data-ccardview="list" title="一条一行：能排序、能分组"><i class="fa-solid fa-list"></i></span>'
        + '<span class="ssp-pbtn' + (orbPickView === 'grid' ? ' primary' : '') + '" data-ccardview="grid" title="头像墙：一屏看最多张"><i class="fa-solid fa-table-cells"></i></span>'
        + '<span class="ssp-pbtn" data-orb-chtolist="1" title="管卡 / 导入 / 标签 / 分页仍然在酒馆原生列表里"><i class="fa-solid fa-list-ul"></i> 打开角色列表</span>'
        + '</div>'
        + (groups.length || ungrouped ? '<div class="ssp-ch-gbar">' + chips + '</div>' : '')
        + '<div class="ssp-orb-pcount">' + (q || orbPickGroup ? '筛出 ' : '共 ') + list.length + (total !== list.length ? (' / ' + total) : '') + ' / ' + all.length + ' 张卡'
        + (orbPickView === 'list' ? ' · 用 ↑↓ 调顺序' : '') + '</div>';
    if (!list.length) {
        return head + '<div class="ssp-orb-empty">没有匹配的卡。'
            + (q ? '换个词试试。' : (orbPickGroup ? '这个分组下还没有卡（点「全部」看其它）' : '（这里是空的 —— 收藏夹为空？还是还没有角色卡？）')) + '</div>';
    }
    if (orbPickView === 'grid') {
        return head + '<div class="ssp-ch-grid">' + list.map(orbCardRowHTML).join('') + '</div>';
    }
    return head + '<div class="ssp-ch-glist">' + list.map(c => (orbCardListRowHTML(c)
        + (chCardEdit === c.avatar ? orbCardGroupEditorHTML(c.avatar, c) : ''))).join('') + '</div>';
}

/** 点一张卡：走酒馆**自己的选角 API**（`ctx.selectCharacterById`，export 出来的公开方法）。
    ⚠️ 这里绝对不要用"点原生 .character_select 元素"那条路：
       实测那样做时酒馆的选卡流程会**把 #rm_ch_create_block（含整个 form）从 DOM 摘掉重建**
       （点卡 600ms 后 `document.getElementById('rm_ch_create_block')` 就是 null 了），
       我们再 append 就挂到了脱链的孤儿节点上。走 API 则不会碰那块。
    ⚠️ switchMenu 必须传 false —— 传 true 时酒馆会去调
       `selectRightMenuWithAnimation('rm_ch_create_block')`，那是"在右侧抽屉里显示"，
       会把用户的右侧面板菜单切走（我们只想在口袋里写卡）。 */
function orbCardOpen(avatar) {
    try {
        const all = orbCardsList();
        let chid = -1;
        for (let i = 0; i < all.length; i++) { if (all[i] && all[i].avatar === avatar) { chid = i; break; } }
        if (chid < 0) { toast('没找到这张卡（列表可能还没加载）', 'warning'); return false; }
        const ctx = getContext() || {};
        if (typeof ctx.selectCharacterById !== 'function') { toast('酒馆没导出选角接口，先在酒馆里切到它', 'warning'); return false; }
        /* ⚠️ selectCharacterById 是**异步**的：立刻重画面板只会画到"上一张卡"，
           用户看到的就是「点了没反应，要关掉口袋再打开才刷新」（实测反馈）。
           所以等它 resolve 之后再：①把写卡骨架标记成"要重读" ②关掉口袋，直接落到聊天页。 */
        /* ⚠️ selectCharacterById 是**异步**的。用户原话：
           「点对话 → 还得点空白把口袋弄掉 → 再点球进去，才看到那个对话界面」
           → 所以这里等它 resolve 之后：①把写卡骨架标记成"要重读" ②**把口袋收起来**，
           让用户直接落在聊天页（口袋是全屏浮层，不收起来就挡着聊天）。 */
        Promise.resolve(ctx.selectCharacterById(chid, { switchMenu: false }))
            .then(() => {
                globalThis.setTimeout?.(() => {
                    try {
                        chPulledOnce = false;
                        chDirtyReset && chDirtyReset();
                    } catch (e) { }
                    try { if (orbOpenNow) closeOrb(); } catch (e) { }   // 收起口袋 → 直接看到聊天页
                }, 600);
            })
            .catch(() => { });
        return true;
        return true;
    } catch (e) { toast('打开失败：' + (e && e.message), 'warning'); return false; }
}

/** 打开写卡页签（不再"搬块"：块留在原地被 pin 样式藏住，我们只画自己的面板） */
function orbEditorOpen() {
    orbTab = 'editor';
    orbEditing = null;
    if (!orbOpenNow) { try { openOrb(); } catch (e) { } }
    try { renderOrbPanel(); } catch (e) { }              // ← 里面会 chMountFrame + chPull
    try {
        const box = document.getElementById(VAULT_BOX);
        if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start' });
    } catch (e) { }
    return true;
}
/** 兼容旧接口：这一版不需要"晚点再搬"了，留着是为了测试与旧调用不炸 */
function orbEditorMountSoon() { try { chMountFrame(); } catch (e) { } return true; }
function orbEditorMount() { return chMountFrame(); }
function orbEditorUnmount() { return chUnmountFrame(); }

/** 新建空白卡：走原生的 `#rm_button_create`（它会设 createcharacter 并把原生字段清成 create_save） */
function orbCardNew() {
    try {
        const btn = query('#rm_button_create');
        if (btn) { btn.click(); }
        else { toast('找不到「新建角色」按钮（可能被工坊搬到别处了）', 'warning'); return false; }
        /* 原生新建会把原生字段清成 create_save 的值 → 等它落定再把值 pull 回我们的面板 */
        setTimeout(() => { try { chPull(true); } catch (e) { } }, 260);
        setTimeout(() => { try { orbEditorOpen(); } catch (e) { } }, 360);
        setTimeout(() => { try { chPull(true); } catch (e) { } }, 620);
        return true;
    } catch (e) { toast('新建失败：' + (e && e.message), 'warning'); return false; }
}
function orbOpenNativeList() {
    try {
        const btn = query('#rm_button_characters');
        if (btn) { btn.click(); toast('已打开酒馆原生的角色列表（在右侧）', 'info'); return true; }
    } catch (e) { }
    toast('找不到角色列表按钮', 'warning');
    return false;
}

/* ============================ 消息查找（v1.31.60）============================
   用户要的：「消息查找，自动分类 ai 消息和用户消息，点击即可导航到对应消息条」。

   - 数据源：`getContext().chat`（每条有 mes / is_user / is_system / send_date / name），**不扫 DOM**
   - 分类：me（我）/ ai（角色）/ sys（系统旁白）—— 就是 is_user / is_system 两个字段，天然准确
   - 默认**跳过思维链**（我们收纳进折叠块的那些）；设置里给开关可以连它一起搜
   - 点一条 → 滚到 `#chat .mes[mesid=N]` 并闪一下；手机上面板是全屏的，所以先关面板再滚
   - 匹配：不区分大小写/全半角（NFKC），空格分隔多个词 = **全部命中**
   ========================================================================== */
var orbFindQ = '';
var orbFindCat = 'all';        // all | ai | me | sys
var orbFindCur = -1;           // 当前停在列表里的第几条（上一条/下一条用）
var orbFindSort = 'desc';      // desc = 最新在上（默认）；asc = 最早在上
var orbFindShow = 100;         // 列表先渲染多少条（点「显示更多」再加 100）

/** 思维链标签（跟"思维链收纳"用同一份设置） */
function findThinkTags() {
    const raw = String(getSettings().thinkTags || 'think,thinking,thought');
    return raw.split(',').map(s => s.trim()).filter(Boolean)
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
/** 把思维链内容从文本里剥掉（只用于搜索；不动消息本身） */
function findStripThink(text) {
    let t = String(text || '');
    const tags = findThinkTags();
    if (!tags.length) return t;
    try {
        const pair = new RegExp('<(' + tags.join('|') + ')[^>]*>[\\s\\S]*?<\\/\\1>', 'gi');
        t = t.replace(pair, ' ');
    } catch (e) { }
    try {
        const single = new RegExp('<\\/?(' + tags.join('|') + ')[^>]*>', 'gi');
        t = t.replace(single, ' ');
    } catch (e) { }
    return t;
}
function findUseThink() {
    const s = getSettings();
    if (typeof s.findThink !== 'boolean') s.findThink = false;
    return s.findThink;
}
/** 归一化（只用于"找位置"，展示仍用原文）：全角→半角 + 转小写 */
function findNorm(s) {
    try { return String(s || '').normalize('NFKC').toLowerCase(); }
    catch (e) { return String(s || '').toLowerCase(); }
}
function findTerms() { return findNorm(orbFindQ || '').split(/\s+/).filter(Boolean); }
function findChat() {
    try { const c = getContext() || {}; return Array.isArray(c.chat) ? c.chat : []; } catch (e) { return []; }
}
function findUserName() { try { return String((getContext() || {}).name1 || '我'); } catch (e) { return '我'; } }
function findCharName() {
    try {
        const ctx = getContext() || {};
        const c = (ctx.characters || [])[ctx.characterId];
        return (c && c.name) || 'AI';
    } catch (e) { return 'AI'; }
}
function findMsgCat(m) {
    if (!m) return 'sys';
    if (m.is_user) return 'me';
    if (m.is_system) return 'sys';
    return 'ai';
}
function findCatName(cat) {
    return cat === 'me' ? findUserName() : (cat === 'sys' ? '系统' : findCharName());
}
/** 这条消息用于搜索的文本（按设置决定要不要剥掉思维链） */
function findTextOf(m) {
    const raw = String((m && m.mes) || '');
    return findUseThink() ? raw : findStripThink(raw);
}
/** 跑一遍搜索。counts **不受分类筛选影响**（就是当前关键字下每类的条数） */
function findRun() {
    const terms = findTerms();
    const chat = findChat();
    const counts = { all: 0, ai: 0, me: 0, sys: 0 };
    const hits = [];
    if (!terms.length) return { hits: hits, counts: counts, total: chat.length };
    for (let i = 0; i < chat.length; i++) {
        const cat = findMsgCat(chat[i]);
        const text = findTextOf(chat[i]);
        if (!text) continue;
        const low = findNorm(text);
        let ok = true;
        for (let k = 0; k < terms.length; k++) { if (low.indexOf(terms[k]) < 0) { ok = false; break; } }
        if (!ok) continue;
        hits.push({ id: i, cat: cat, text: text, mes: chat[i] });
        counts.all += 1;
        counts[cat] = (counts[cat] || 0) + 1;
    }
    return { hits: hits, counts: counts, total: chat.length };
}
/** 按当前分类筛选命中 */
function findFiltered(run) {
    const r = run || findRun();
    return orbFindCat === 'all' ? r.hits.slice() : r.hits.filter(h => h.cat === orbFindCat);
}
/** 找一段能看清的片段（关键字附近），并把命中的词包成 <mark> */
function findSnippet(text, terms) {
    const src = String(text || '').replace(/\s+/g, ' ').trim();
    if (!src) return '';
    const lowN = findNorm(src);
    let at = -1;
    for (let i = 0; i < terms.length; i++) {
        const k = lowN.indexOf(terms[i]);
        if (k >= 0 && (at < 0 || k < at)) at = k;
    }
    if (at < 0) at = 0;
    const start = Math.max(0, at - 22);
    const end = Math.min(src.length, at + 90);
    const raw = src.slice(start, end);
    /* 高亮：在**这一段原文**上做大小写不敏感的区间合并（NFKC 可能改长度，所以这里只 toLowerCase） */
    const low = raw.toLowerCase();
    const ranges = [];
    const lows = terms.map(t => t.toLowerCase());
    lows.forEach(t => {
        if (!t) return;
        let from = 0;
        for (; ;) {
            const k = low.indexOf(t, from);
            if (k < 0) break;
            ranges.push([k, k + t.length]);
            from = k + t.length;
            if (ranges.length > 60) break;
        }
    });
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    ranges.forEach(r => {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
    });
    let html = '', pos = 0;
    merged.forEach(r => {
        html += esc(raw.slice(pos, r[0])) + '<mark>' + esc(raw.slice(r[0], r[1])) + '</mark>';
        pos = r[1];
    });
    html += esc(raw.slice(pos));
    return (start > 0 ? '…' : '') + html + (end < src.length ? '…' : '');
}
/** 消息时间（读不懂就留空） */
function findTime(m) {
    try {
        const d = new Date(m && m.send_date);
        if (isNaN(d.getTime())) return '';
        const p = n => (n < 10 ? '0' + n : '' + n);
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
}
/** 列表用哪一批行：**不搜的时候就是整段聊天**（常驻展示），搜的时候就是命中那些。
    排序：orbFindSort = 'desc'（最新在上，默认） / 'asc'（最早在上）。
    ⚠️ 用户明确要的是"上方搜索栏、下方常驻展示、一边打一边筛"，不是"搜了才出结果"。 */
function findRows() {
    const terms = findTerms();
    const chat = findChat();
    let list;
    if (terms.length) {
        list = findFiltered(findRun());
    } else {
        list = chat.map((m, i) => ({ id: i, cat: findMsgCat(m), text: findTextOf(m), mes: m }));
        if (orbFindCat !== 'all') list = list.filter(h => h.cat === orbFindCat);
    }
    return orbFindSort === 'desc' ? list.slice().reverse() : list;
}

/** 结果列表（单独一块，输入时只重画它，输入框不会丢焦点） */
function orbFindBodyHTML() {
    const run = findRun();
    const terms = findTerms();
    const at = { all: '全部', ai: '🤖 ' + findCharName(), me: '👤 ' + findUserName(), sys: '⚙ 系统' };
    const chats = findChat();
    /* 没搜的时候，分类 chip 上的数字是"这一类一共几条"（最有用） */
    const counts = terms.length ? run.counts : (() => {
        const c = { all: chats.length, ai: 0, me: 0, sys: 0 };
        chats.forEach(m => { const k = findMsgCat(m); c[k] = (c[k] || 0) + 1; });
        return c;
    })();
    const chips = ['all', 'ai', 'me', 'sys'].map(k =>
        '<span class="ssp-pbtn' + (orbFindCat === k ? ' primary' : '') + '" data-orb-findcat="' + k + '">'
        + esc(at[k]) + ' ' + (counts[k] || 0) + '</span>').join('');
    const sortChip = '<span class="ssp-pbtn" data-orb-findsort="1" title="切换顺序">'
        + (orbFindSort === 'desc' ? '最新在上 ↓' : '最早在上 ↑') + '</span>';
    const list = findRows();
    const shown = list.slice(0, orbFindShow);
    const rows = shown.map((h, idx) => {
        const who = h.cat === 'me' ? findUserName() : (h.cat === 'sys' ? '系统' : ((h.mes && h.mes.name) || findCharName()));
        const cur = (idx === orbFindCur) ? ' cur' : '';
        return '<div class="ssp-find-row' + cur + '" data-orb-findrow="' + h.id + '" title="点一下跳到这一条">'
            + '<span class="ssp-find-tag ' + h.cat + '">' + (h.cat === 'me' ? '我' : (h.cat === 'sys' ? '系统' : 'AI')) + '</span>'
            + '<span class="ssp-find-main"><b>第 ' + (h.id + 1) + ' 条 · ' + esc(String(who)) + ' · ' + esc(findTime(h.mes)) + '</b>'
            + '<i class="ssp-find-snip">' + findSnippet(h.text, terms) + '</i></span>'
            + '</div>';
    }).join('');
    const head = '<div class="ssp-orb-pcount ssp-find-bar">'
        + '<span>' + (terms.length ? ('命中 <b>' + list.length + '</b> 条') : ('共 <b>' + list.length + '</b> 条'))
        + (list.length > shown.length ? '（显示前面 ' + shown.length + ' 条）' : '') + '</span>'
        + '<span class="ssp-pbtn" data-orb-findprev="1" title="上一条">↑ 上一条</span>'
        + '<span class="ssp-pbtn" data-orb-findnext="1" title="下一条">↓ 下一条</span>'
        + '</div>';
    const more = list.length > shown.length
        ? '<div class="ssp-orb-pcount"><span class="ssp-pbtn" data-orb-findmore="1">显示更多（还有 '
            + (list.length - shown.length) + ' 条）</span></div>' : '';
    const empty = list.length ? ''
        : '<div class="ssp-orb-empty">' + (terms.length ? '这个分类里没有命中 —— 换个分类或关键字试试。'
            : (chats.length ? '这一类里没有消息。' : '这个聊天还没有消息。')) + '</div>';
    const hint = terms.length
        ? '<div class="ssp-orb-empty" style="padding-top:2px">消息是酒馆的<b>原文</b>：屏幕上渲染出来的按钮/样式文字搜不到，'
            + '思维链默认跳过（上面那个勾可以打开）。空格分隔多个词＝要全部命中。</div>'
        : '<div class="ssp-orb-empty" style="padding-top:2px">下面就是整个聊天（不搜也一直列着）。'
            + '上面打字＝就地筛选；点任意一条就跳过去。空格分隔多个词＝要全部命中。</div>';
    return '<div class="ssp-orb-pcount ssp-find-cats">' + chips + sortChip + '</div>'
        + head
        + (rows ? '<div class="ssp-orb-wlist ssp-find-list">' + rows + '</div>' : '')
        + more + empty + hint;
}

function orbFindHTML() {
    const run = findRun();
    const box = '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-findq="1" placeholder="在上面打字＝就地筛下面这个列表（空格分隔＝全部命中）" value="' + esc(orbFindQ) + '">'
        + (orbFindQ ? '<span class="ssp-pbtn" data-orb-findclear="1">清除</span>' : '')
        + '</div>';
    const opt = '<label class="ssp-orb-auto" style="padding-top:2px"><input type="checkbox" data-orb-findthink="1"'
        + (findUseThink() ? ' checked' : '') + '><span>连思维链一起搜</span></label>';
    return box + opt + '<div id="ssp_orb_find_body">' + orbFindBodyHTML() + '</div>';
}

/** 跳到某条消息：滚到它 + 闪一下。手机上面板是全屏的，先关面板（否则看不见跳过去的东西）
    ⚠️ 对齐的是**消息头部**，不是居中 —— 用户报过"传送到消息中间而不是头部"：
       v1.31.60/61 用的是 scrollIntoView({block:'center'})，消息一长，屏幕中间正好是消息的中段，
       头部被顶到视口上面去了（等于"跳进去以后还得自己往上找"）。
       现在自己算 #chat 的 scrollTop：让这条消息的**上沿**落在聊天区上沿下面一点（留 8px 呼吸），
       跟酒馆自己的滚动容器一致；找不到 #chat 才退回 scrollIntoView。 */
function orbFindGo(id, quiet) {
    const idx = Number(id);
    if (!isFinite(idx) || idx < 0) return false;
    const el = document.querySelector('#chat .mes[mesid="' + idx + '"]');
    if (!el) {
        if (!quiet) toast('这条没在当前聊天里渲染出来（可能被折叠/隐藏了）', 'warning');
        return false;
    }
    let mobile = false;
    try { mobile = Boolean((getContext() || {}).isMobile?.()); } catch (e) { }
    if (mobile) { try { closeOrb(); } catch (e) { } }
    globalThis.setTimeout?.(() => {
        /* 头部对齐：优先自己算（可控），算不出来才退回 scrollIntoView */
        let done = false;
        try {
            const chat = document.getElementById('chat');
            if (chat && chat.scrollHeight > chat.clientHeight + 2) {
                const cRect = chat.getBoundingClientRect();
                const eRect = el.getBoundingClientRect();
                const want = Math.max(0, chat.scrollTop + (eRect.top - cRect.top) - 8);
                /* **瞬时**滚动，不用 smooth：实测 smooth 在这一下会被打断/回弹（点了结果位置没变），
                   而且搜索定位本来也不该让人等一段动画。 */
                chat.scrollTop = want;
                done = true;
            }
        } catch (e) { }
        if (!done) {
            try { el.scrollIntoView({ block: 'start' }); }
            catch (e) { try { el.scrollIntoView(); } catch (e2) { } }
        }
        try {
            el.classList.remove('ssp-find-flash');
            void el.offsetWidth;                       // 重启动画
            el.classList.add('ssp-find-flash');
            /* ⚠️ 定时器要挂在元素上、并且先清掉上一个：连着跳两条时，上一条的"收闪烁"
               定时器会把这一条刚加上的类立刻删掉（实测：第二条不闪了）。 */
            try { if (el.__sspFindTimer) globalThis.clearTimeout(el.__sspFindTimer); } catch (e) { }
            el.__sspFindTimer = globalThis.setTimeout?.(() => { try { el.classList.remove('ssp-find-flash'); } catch (e) { } }, 2200);
        } catch (e) { }
    }, mobile ? 260 : 40);
    return true;
}
/** 上一条 / 下一条（在当前这个列表里走 —— 不搜的时候就是整个聊天） */
function orbFindStep(step) {
    const list = findRows();
    if (!list.length) { toast('没有可跳的消息', 'info'); return false; }
    let i = orbFindCur;
    if (i < 0 || i >= list.length) i = step > 0 ? -1 : 0;
    i = (i + step + list.length) % list.length;
    orbFindCur = i;
    orbFindGo(list[i].id);
    if (orbOpenNow && orbTab === 'find') renderOrbPanel();   // 让高亮那一行跟手
    return true;
}

/** 面板里的模块表 —— 以后加功能往这里加一项
    ⚠️ 调试是**最后一个**页签：加在末尾，前面 9 个页签的顺序和位置一个都不动
       （用户要求"按钮位置不变"）。 */
const ORB_MODULES = [
    { id: 'pick', name: '选卡', icon: 'fa-images', render: () => orbPickHTML() },
    { id: 'editor', name: '写卡', icon: 'fa-pen-to-square', render: () => orbEditorHTML() },
    { id: 'notes', name: '番外', icon: 'fa-feather-pointed', render: () => orbNotesHTML() },
    { id: 'persona', name: '面具', icon: 'fa-masks-theater', render: () => orbPersonaHTML() },
    { id: 'preset', name: '预设', icon: 'fa-sliders', render: () => orbPresetHTML() },
    { id: 'theme', name: '美化', icon: 'fa-palette', render: () => orbThemeHTML() },
    { id: 'world', name: '世界书', icon: 'fa-book-atlas', render: () => orbWorldHTML() },
    { id: 'dlc', name: 'DLC', icon: 'fa-cubes', render: () => orbDlcHTML() },
    { id: 'bg', name: '背景', icon: 'fa-image', render: () => orbBgHTML() },
    { id: 'chat', name: '存档', icon: 'fa-box-archive', render: () => orbChatHTML() },
    { id: 'data', name: '数据', icon: 'fa-database', render: () => orbDataHTML() },
    /* v1.31.60：消息查找 —— **加在「调试」前面**（调试仍然是最后一个，其余页签顺序一个没动） */
    { id: 'find', name: '查找', icon: 'fa-magnifying-glass', render: () => orbFindHTML() },
    { id: 'debug', name: '调试', icon: 'fa-code', render: () => orbDbgHTML() },
];
function orbModule(id) { return ORB_MODULES.find(m => m.id === id) || null; }

/* ============================ 数据（全量备份导出）栏 ============================
   用户要的：点一下就把散在酒馆十几个地方的数据打成一个 zip，换机器/重装时有个整包。

   数据来源（一个个对过酒馆源码，不是猜的）：
     · POST /api/settings/get —— 服务端**把目录直接读出来塞进响应**，一次就能拿到：
         settings        settings.json 原文（面具 personas / 本扩展的 shushu_panel / 标签 / 世界书设置全在里面）
         themes          全部美化文件内容
         openai_settings / textgenerationwebui_presets / novelai_settings / koboldai_settings（+ 名字）
         instruct / context / sysprompt / reasoning 模板 · quickReplyPresets · movingUIPresets
         world_names     世界书名字清单
     · /api/characters/all 拿角色列表；/characters/<文件> 是**静态路径**，直接 GET 原图（卡数据在 PNG 里）
     · /api/characters/chats {simple:true} 拿该角色的聊天文件清单
       /api/chats/export {format:'jsonl'} 返回**原始 jsonl 文本**（不是转成 txt 的那种）
     · /api/worldinfo/get · /api/groups/all · /api/avatars/get · /api/backgrounds/all
     · /User%20Avatars/<文件>、/backgrounds/<文件> 同样是静态路径
   打 zip 用酒馆自带的 JSZip（public/lib/jszip.min.js —— 酒馆自己的 utils.js 就是 import 它），不引外部 CDN。

   ⚠️ 这里是**只读**的：全程只 GET/POST 读接口，不写你库里任何东西。
   ========================================================================== */
const ORB_DATA_CATS = [
    { id: 'chars', name: '角色卡', hint: 'PNG 原图，卡数据在里面', def: true },
    { id: 'chats', name: '聊天记录', hint: '原始 .jsonl，按角色分文件夹', def: true },
    { id: 'sprites', name: '表情差分', hint: '角色文件夹里的表情图，要连文件夹一起放回去', def: true },
    { id: 'worlds', name: '世界书', hint: '每本书的全部条目', def: true },
    { id: 'settings', name: '酒馆设置', hint: 'settings.json 原文（面具文本/标签/扩展数据都在这）', def: true },
    { id: 'presets', name: '预设 · 模板', hint: '4 个 API + 指令/上下文/系统提示/推理/快捷回复/布局', def: true },
    { id: 'themes', name: '美化', hint: '全部主题文件', def: true },
    { id: 'personas', name: '面具头像', hint: 'User Avatars 里的图', def: true },
    { id: 'groups', name: '群组 · 群聊', hint: '群组设定 + 群聊记录', def: true },
    { id: 'media', name: '背景图', hint: '最大的一项，网慢就别勾', def: false },
];
var orbDataPick = {};        // id → 勾没勾（懒初始化成 def）
var orbDataBusy = false;
var orbDataLine = '';        // 当前进度
var orbDataDone = null;      // 上次结果 { name, size, summary }
var orbDataLog = [];         // 单项失败明细（不中断整包）

function orbDataCat(id) { return ORB_DATA_CATS.find(c => c.id === id) || null; }
function orbDataPickOf(id) {
    if (!(id in orbDataPick)) { const c = orbDataCat(id); orbDataPick[id] = !!(c && c.def); }
    return orbDataPick[id];
}
function orbDataPicked() { return ORB_DATA_CATS.filter(c => orbDataPickOf(c.id)).map(c => c.id); }

function orbDataFmtSize(n) {
    const b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
}
function orbDataStamp(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}
/** 名字里的非法字符换掉 —— 它们是**酒馆里的名字**，要变成 zip 里的路径，不能带 / \ : 这些 */
function orbDataSafe(name, fallback) {
    const s = String(name == null ? '' : name)
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/^\.+/, '')
        .trim();
    return s.slice(0, 120) || fallback || 'unnamed';
}

function orbDataHTML() {
    const rows = ORB_DATA_CATS.map(c => '<label class="ssp-orb-auto" style="display:flex;margin:3px 0">'
        + '<input type="checkbox" data-orb-datacat="' + esc(c.id) + '"' + (orbDataPickOf(c.id) ? ' checked' : '') + '>'
        + '<b style="font-weight:600">' + esc(c.name) + '</b>'
        + (c.hint ? '<span style="opacity:.5">' + esc(c.hint) + '</span>' : '')
        + '</label>').join('');
    let html = '<div class="ssp-orb-empty" style="padding:2px 0 9px">'
        + '把酒馆里散着的数据打成一个 zip：角色卡 / 聊天记录 / 世界书 / 面具 / 预设 · 模板 / 美化 / 群组 / 背景图。'
        + '包里带 <b>说明.txt</b> 和 <b>manifest.json</b>（清单 + 每项数量），换机器照着放回去就行。</div>'
        + '<div class="ssp-orb-fl" style="margin-bottom:4px"><span>要导哪些</span>' + rows + '</div>'
        + '<div class="ssp-orb-nnew">'
        + '<span class="ssp-pbtn' + (orbDataBusy ? '' : ' primary') + '" data-orb-dataexport="1">'
        + (orbDataBusy ? '<i class="fa-solid fa-spinner fa-spin"></i>打包中…' : '<i class="fa-solid fa-file-zipper"></i>一键导出全部')
        + '</span></div>';
    if (orbDataBusy || orbDataLine) html += '<div class="ssp-orb-pcount">' + esc(orbDataLine) + '</div>';
    if (orbDataLog.length) {
        html += '<div class="ssp-orb-empty" style="padding:4px 0;color:#ffb3bb">'
            + orbDataLog.slice(-8).map(esc).join('<br>')
            + (orbDataLog.length > 8 ? '<br>…共 ' + orbDataLog.length + ' 条' : '') + '</div>';
    }
    if (orbDataDone) {
        html += '<div class="ssp-orb-empty" style="padding:8px 0 0">上次导出：<b>' + esc(orbDataDone.name) + '</b>'
            + '（' + esc(orbDataDone.size) + '）<br>' + esc(orbDataDone.summary) + '</div>';
    }
    html += '<div class="ssp-orb-empty" style="padding-top:9px">'
        + '全程只读 —— 不会改动你库里任何东西。打包在浏览器里做，大包会占一点内存；背景图那项动辄几百 MB。<br>'
        + '不含：酒馆的自动备份目录 data/backups/、user/files 里没有列表接口的扩展私有文件、缩略图（会重建）。</div>';
    return html + orbImpHTML();
}

/* ---- 读接口的两个小封装（都在同一个 origin，带上酒馆的请求头） ---- */
async function orbDataPost(url, body) {
    const ctx = getContext() || {};
    const res = await fetch(url, {
        method: 'POST',
        headers: ctx.getRequestHeaders ? ctx.getRequestHeaders() : {},
        body: JSON.stringify(body || {}),
        cache: 'no-cache',
    });
    if (!res || !res.ok) throw new Error(url + ' → HTTP ' + (res ? res.status : '网络错误'));
    return await res.json();
}
async function orbDataBlob(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res || !res.ok) throw new Error(url + ' → HTTP ' + (res ? res.status : '网络错误'));
    return await res.blob();
}
/** 数组或对象都要吃得下（不同端点的返回形状不完全一样）
    ⚠️ backgrounds/all 回的是 {images:[…]}、characters/chats 可能是 {chats:[…]} ——
       漏一个形状就是整类数据静默变 0（背景图就这么漏过一次）。 */
function orbDataArr(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.chats)) return v.chats;
    if (v && Array.isArray(v.images)) return v.images;
    if (v && Array.isArray(v.items)) return v.items;
    return [];
}
function orbDataNameOf(o, i, prefix) {
    if (typeof o === 'string') return orbDataSafe(o, prefix + (i + 1));
    return orbDataSafe((o && (o.name || o.filename || o.file_name)) || (prefix + (i + 1)), prefix + (i + 1));
}

/** 说明.txt —— 换机器的人（或半年后的自己）照着这个放回去 */
function orbDataReadme(counts, picks) {
    const L = [];
    L.push('鼠鼠小助手 · 全量数据备份');
    L.push('导出时间：' + new Date().toLocaleString());
    L.push('');
    L.push('一、包里有什么（数量见 manifest.json）');
    L.push('  settings.json        酒馆设置原文 —— 面具(personas)/标签/世界书设置/各扩展数据都在里面');
    L.push('  characters/          角色卡 PNG 原图（卡数据在 PNG 里，酒馆直接认）');
    L.push('  characters/<角色>/   该角色的表情差分图（酒馆的约定就是放这儿）');
    L.push('  chats/<角色>/        聊天记录，原始 .jsonl');
    L.push('  worlds/              世界书（每本一个 json）');
    L.push('  themes/              美化（主题文件）');
    L.push('  presets/             预设与模板：openai / textgen / novelai / koboldai /');
    L.push('                       instruct / context / sysprompt / reasoning / quickreplies / movingUI');
    L.push('  groups/              群组设定');
    L.push('  group chats/         群聊记录');
    L.push('  User Avatars/        面具头像');
    L.push('  backgrounds/         背景图');
    L.push('');
    L.push('二、怎么放回去（全部放进 data/<你的用户名>/ 下面）');
    L.push('  settings.json   → 直接覆盖同名文件（放之前先备份现有的！）');
    L.push('  characters/     → characters/');
    L.push('  chats/          → chats/（里面已经是「角色名/聊天文件.jsonl」的层级）');
    L.push('  worlds/         → worlds/');
    L.push('  themes/         → themes/');
    L.push('  presets/openai  → OpenAI Settings/        presets/textgen → TextGen Settings/');
    L.push('  presets/novelai → NovelAI Settings/       presets/koboldai → KoboldAI Settings/');
    L.push('  presets/instruct → instruct/              presets/context → context/');
    L.push('  presets/sysprompt → sysprompt/            presets/reasoning → reasoning/');
    L.push('  presets/quickreplies → QuickReplies/      presets/movingUI → movingUI/');
    L.push('  groups/         → groups/                 group chats/ → group chats/');
    L.push('  User Avatars/   → User Avatars/           backgrounds/ → backgrounds/');
    L.push('  放完刷新酒馆页面。');
    L.push('');
    L.push('三、注意');
    L.push('  · 这份包是**只读导出**出来的，没改动原库任何东西。');
    L.push('  · 面具(persona)的文字在 settings.json 里；头像在 User Avatars/ 里，两边要一起放回去。');
    L.push('  · 本扩展自己的数据（面具/预设/美化绑定、存档记录、世界书栏绑定、DLC、番外）');
    L.push('    存在 settings.json 的 extension_settings.shushu_panel 里，跟着 settings.json 一起走。');
    L.push('');
    L.push('四、这份包**不含**什么（以及为什么）');
    L.push('  · data/backups/（酒馆自己滚动的聊天/设置自动备份，通常几十上百 MB）—— 要就整个目录一起拷。');
    L.push('  · user/files、user/images 里的扩展私有文件（手机相册、主题引擎变量等）—— 酒馆没有列表接口，读不到；');
    L.push('    其中一部分数据本来就在 settings.json 的 extension_settings 里，已经在包里了。');
    L.push('  · thumbnails/（缩略图，酒馆会自己重新生成）。');
    if (counts && counts.__failed) L.push('  · 有 ' + counts.__failed + ' 项没拿到（见面板上的失败明细）。');
    L.push('');
    return L.join('\n');
}

/** 真正干活：把选中的类别收进一个 JSZip，返回 { blob, name, counts }。
    单项失败不中断（记进 orbDataLog），最后照常出一个包 —— 有总比没有强。 */
async function orbDataBuild() {
    const picks = orbDataPicked();
    const counts = {};
    const hdrs = () => { const c = getContext() || {}; return c.getRequestHeaders ? c.getRequestHeaders() : {}; };
    const now = new Date();
    const root = '鼠鼠备份_' + orbDataStamp(now) + '/';
    let lastPaint = 0;
    const say = s => {
        orbDataLine = s;
        const t = Date.now();
        if (orbOpenNow && orbTab === 'data' && t - lastPaint > 120) { lastPaint = t; renderOrbPanel(); }
    };
    orbDataBusy = true; orbDataLog = []; orbDataDone = null;
    say('准备打包器…');
    if (orbOpenNow && orbTab === 'data') renderOrbPanel();
    const zip = new (await orbDataZipCtor())();
    const put = (p, d) => zip.file(root + p, d);

    /* ① 一次 settings/get：酒馆会把 themes / 预设 / 模板 / 世界书名 全塞在这个响应里 */
    let S = null;
    const needS = picks.some(p => p === 'settings' || p === 'presets' || p === 'themes' || p === 'worlds');
    if (needS) {
        say('读取酒馆设置 / 预设 / 主题…');
        S = await orbDataPost('/api/settings/get', {});
    }

    /* ② 角色卡（静态路径直接拿原图） */
    let chars = [];
    if (picks.includes('chars') || picks.includes('chats')) {
        try { chars = orbDataArr(await orbDataPost('/api/characters/all', {})); }
        catch (e) { orbDataLog.push('角色列表：' + e.message); }
    }
    if (picks.includes('chars')) {
        let i = 0;
        for (const c of chars) {
            const av = String((c && c.avatar) || '');
            if (!av) continue;
            i += 1;
            say('角色卡 ' + i + '/' + chars.length + '：' + ((c && c.name) || av));
            try { put('characters/' + orbDataSafe(av, 'card' + i + '.png'), await orbDataBlob('/characters/' + encodeURIComponent(av))); }
            catch (e) { orbDataLog.push('角色卡 ' + av + '：' + e.message); }
        }
        counts.characters = i;
    }

    /* ③ 聊天记录（要原始 jsonl：export 带 format:'jsonl' 时它直接回原文） */
    if (picks.includes('chats')) {
        let n = 0, done = 0;
        for (const c of chars) {
            const av = String((c && c.avatar) || '');
            if (!av) continue;
            const dir = orbDataSafe(String((c && c.name) || av).replace(/\.png$/i, ''), '未命名');
            let list = [];
            try { list = orbDataArr(await orbDataPost('/api/characters/chats', { avatar_url: av, simple: true })); }
            catch (e) { orbDataLog.push('聊天清单 ' + av + '：' + e.message); continue; }
            for (const it of list) {
                const f0 = String((it && (it.file_name || it.file)) || '');
                if (!f0) continue;
                const file = /\.jsonl$/i.test(f0) ? f0 : f0 + '.jsonl';
                try {
                    const ex = await orbDataPost('/api/chats/export', {
                        file: file, avatar_url: av, format: 'jsonl', exportfilename: file,
                    });
                    put('chats/' + dir + '/' + orbDataSafe(file, 'chat.jsonl'), String((ex && ex.result) || ''));
                    n += 1;
                    if (n % 5 === 0) say('聊天记录 ' + n + ' 份…');
                } catch (e) { orbDataLog.push('聊天 ' + file + '：' + e.message); }
            }
            done += 1;
            if (done % 4 === 0) say('聊天记录：已扫 ' + done + '/' + chars.length + ' 张卡，拿到 ' + n + ' 份');
        }
        counts.chats = n;
    }

    /* ④-2 表情差分：/api/sprites/get?name=<角色文件夹> 返回 {label, path}，path 直接能 GET。
       落盘位置照酒馆的约定：characters/<角色文件夹>/<表情文件> —— 恢复时把文件夹整个拷回去就认。 */
    if (picks.includes('sprites') && chars.length) {
        let n = 0;
        for (const c of chars) {
            const av = String((c && c.avatar) || '');
            if (!av) continue;
            const base = av.replace(/\.png$/i, '');
            const folder = orbDataSafe(base, 'char');
            let list = [];
            try {
                const res = await fetch('/api/sprites/get?name=' + encodeURIComponent(base), { cache: 'no-cache' });
                if (res.ok) list = orbDataArr(await res.json());
            } catch (e) { orbDataLog.push('表情清单 ' + folder + '：' + e.message); }
            if (!list.length) continue;
            say('表情差分：' + folder + '（' + list.length + ' 张）');
            for (const it of list) {
                const p = String((it && it.path) || '').split('?')[0];
                const file = p.split('/').pop();
                if (!p || !file) continue;
                try { put('characters/' + folder + '/' + orbDataSafe(file, 'sprite.png'), await orbDataBlob(p)); n += 1; }
                catch (e) { orbDataLog.push('表情 ' + p + '：' + e.message); }
            }
        }
        counts.sprites = n;
    }

    /* ④ 世界书内容 */
    if (picks.includes('worlds') && S) {
        const names = Array.isArray(S.world_names) ? S.world_names : [];
        let n = 0;
        for (const nm of names) {
            n += 1;
            say('世界书 ' + n + '/' + names.length + '：' + nm);
            try { put('worlds/' + orbDataSafe(nm, 'book' + n) + '.json', JSON.stringify(await orbDataPost('/api/worldinfo/get', { name: nm }), null, 2)); }
            catch (e) { orbDataLog.push('世界书 ' + nm + '：' + e.message); }
        }
        counts.worlds = names.length;
    }

    /* ⑤ settings.json —— 存**原文**，一个字都不动 */
    if (picks.includes('settings') && S && S.settings !== undefined) {
        put('settings.json', typeof S.settings === 'string' ? S.settings : JSON.stringify(S.settings, null, 4));
        counts.settingsJson = 1;
    }

    /* ⑥ 预设与模板（响应里就是解析好的对象数组，按名字落盘） */
    if (picks.includes('presets') && S) {
        /* ⚠️ 四个 API 家族（openai/textgen/novelai/koboldai）服务端回的是**原始 JSON 字符串**，
           不是对象 —— 名字得从配套的 *_names 数组拿，内容原样写（它本身就是合法 JSON 文本）。
           一开始按对象处理，结果整段 JSON 被当成文件名了（真机上试出来的）。 */
        const dumpRaw = (arr, names, sub) => {
            const list = Array.isArray(arr) ? arr : [];
            const nm = Array.isArray(names) ? names : [];
            list.forEach((o, i) => {
                const name = orbDataSafe(nm[i] || (o && o.name) || (sub + (i + 1)), sub + (i + 1));
                put('presets/' + sub + '/' + name + '.json', typeof o === 'string' ? o : JSON.stringify(o, null, 2));
            });
            counts['presets_' + sub] = list.length;
        };
        dumpRaw(S.openai_settings, S.openai_setting_names, 'openai');
        dumpRaw(S.textgenerationwebui_presets, S.textgenerationwebui_preset_names, 'textgen');
        dumpRaw(S.novelai_settings, S.novelai_setting_names, 'novelai');
        dumpRaw(S.koboldai_settings, S.koboldai_setting_names, 'koboldai');
        /* 这四类模板 + 快捷回复 + 布局预设是 readAndParse 出来的**对象**，走原来的 dump */
        const dump = (arr, sub) => {
            const list = Array.isArray(arr) ? arr : [];
            list.forEach((o, i) => put('presets/' + sub + '/' + orbDataNameOf(o, i, sub) + '.json', JSON.stringify(o, null, 2)));
            counts['presets_' + sub] = list.length;
        };
        dump(S.instruct, 'instruct');
        dump(S.context, 'context');
        dump(S.sysprompt, 'sysprompt');
        dump(S.reasoning, 'reasoning');
        dump(S.quickReplyPresets, 'quickreplies');
        dump(S.movingUIPresets, 'movingUI');
    }

    /* ⑦ 美化（主题） */
    if (picks.includes('themes') && S) {
        const list = Array.isArray(S.themes) ? S.themes : [];
        list.forEach((t, i) => put('themes/' + orbDataNameOf(t, i, 'theme') + '.json', JSON.stringify(t, null, 4)));
        counts.themes = list.length;
    }

    /* ⑧ 面具头像 */
    if (picks.includes('personas')) {
        let list = [];
        try { list = orbDataArr(await orbDataPost('/api/avatars/get', {})); }
        catch (e) { orbDataLog.push('头像清单：' + e.message); }
        let n = 0;
        for (let i = 0; i < list.length; i++) {
            const nm = orbDataNameOf(list[i], i, 'avatar');
            n += 1;
            say('面具头像 ' + n + '/' + list.length + '：' + nm);
            try { put('User Avatars/' + nm, await orbDataBlob('/User%20Avatars/' + encodeURIComponent(nm))); }
            catch (e) { orbDataLog.push('头像 ' + nm + '：' + e.message); }
        }
        counts.personaAvatars = n;
    }

    /* ⑨ 群组 + 群聊 */
    if (picks.includes('groups')) {
        let gs = [];
        try { gs = orbDataArr(await orbDataPost('/api/groups/all', {})); }
        catch (e) { orbDataLog.push('群组清单：' + e.message); }
        let gc = 0;
        for (const g of gs) {
            const id = String((g && g.id) || '');
            if (!id) continue;
            say('群组：' + ((g && g.name) || id));
            put('groups/' + orbDataSafe(id, 'group') + '.json', JSON.stringify(g, null, 2));
            try {
                const list = orbDataArr(await orbDataPost('/api/chats/search', { group_id: id }));
                for (const it of list) {
                    const f0 = String((it && it.file_name) || '');
                    if (!f0) continue;
                    const file = /\.jsonl$/i.test(f0) ? f0 : f0 + '.jsonl';
                    const ex = await orbDataPost('/api/chats/export', {
                        file: file, avatar_url: '', is_group: true, format: 'jsonl', exportfilename: file,
                    });
                    put('group chats/' + orbDataSafe(file, 'group.jsonl'), String((ex && ex.result) || ''));
                    gc += 1;
                }
            } catch (e) { orbDataLog.push('群聊 ' + id + '：' + e.message); }
        }
        counts.groups = gs.length;
        counts.groupChats = gc;
    }

    /* ⑩ 背景图 */
    if (picks.includes('media')) {
        let list = [];
        try { list = orbDataArr(await orbDataPost('/api/backgrounds/all', {})); }
        catch (e) { orbDataLog.push('背景清单：' + e.message); }
        let n = 0;
        for (let i = 0; i < list.length; i++) {
            const nm = orbDataNameOf(list[i], i, 'bg');
            n += 1;
            say('背景图 ' + n + '/' + list.length + '：' + nm);
            try { put('backgrounds/' + nm, await orbDataBlob('/backgrounds/' + encodeURIComponent(nm))); }
            catch (e) { orbDataLog.push('背景 ' + nm + '：' + e.message); }
        }
        counts.backgrounds = n;
    }

    /* ⑪ 清单 + 说明 */
    if (orbDataLog.length) counts.failed = orbDataLog.length;
    put('说明.txt', orbDataReadme(counts, picks));
    put('manifest.json', JSON.stringify({
        tool: '鼠鼠小助手 · 数据导出',
        panelVersion: PANEL_VERSION,
        exportedAt: now.toISOString(),
        stVersion: (getContext() || {}).version || '',
        categories: picks,
        counts: counts,
        note: 'settings.json 是原文；其余按酒馆数据目录结构放好了，说明见 说明.txt。',
    }, null, 2));

    say('正在压缩（大包会慢一点）…');
    const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        m => say('正在压缩 ' + Math.round(m.percent) + '%…'));
    const name = '鼠鼠备份_' + orbDataStamp(now) + '.zip';
    counts.__size = blob.size;
    return { blob: blob, name: name, counts: counts };
}

/** 拿 JSZip：酒馆自带（public/lib/jszip.min.js），不引外部 CDN */
async function orbDataZipCtor() {
    if (window.JSZip) return window.JSZip;
    const mod = await import('/lib/jszip.min.js');
    const J = (mod && (mod.default || mod.JSZip)) || window.JSZip;
    if (!J) throw new Error('拿不到酒馆自带的 JSZip');
    return J;
}

function orbDataDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        try { document.body.removeChild(a); } catch (e) { }
        try { URL.revokeObjectURL(url); } catch (e) { }
    }, 5000);
}

async function orbDataExport() {
    if (orbDataBusy) { toast('正在打包了，稍等', 'info'); return false; }
    if (!orbDataPicked().length) { toast('先勾选至少一类数据', 'warning'); return false; }
    orbDataBusy = true;
    let r = null;
    try {
        r = await orbDataBuild();
        orbDataDownload(r.blob, r.name);
        const bits = Object.keys(r.counts).filter(k => k.indexOf('__') !== 0 && k !== 'failed')
            .map(k => k + ' ' + r.counts[k]).join(' · ');
        orbDataDone = { name: r.name, size: orbDataFmtSize(r.blob.size), summary: bits || '（空包？看看是不是都没数据）' };
        orbDataLine = '';
        toast('导出完成：' + r.name + '（' + orbDataFmtSize(r.blob.size) + '）', 'success');
    } catch (e) {
        orbDataLine = '';
        orbDataLog.push('打包失败：' + ((e && e.message) || e));
        toast('导出失败：' + ((e && e.message) || e), 'error');
    }
    orbDataBusy = false;
    if (orbOpenNow && orbTab === 'data') renderOrbPanel();
    return !!r;
}

/* ============================ 数据 · 导入（从备份包恢复） ============================
   用户点头的那套原则：**只认这个包 / 逐项可选 / 写前先自动备份 / 同名覆盖 + 逐条记账**。

   能写回去的（写接口都对着酒馆源码验过形状）：
     角色卡   POST /api/characters/import（multipart，带 preserved_name → 覆盖同名卡）
     聊天     POST /api/chats/import（multipart：avatar_url / character_name / user_name / file_type=jsonl / file）
     表情     POST /api/sprites/upload（multipart：name=角色文件夹 / label / avatar / spriteName）
     世界书   POST /api/worldinfo/edit { name, data }
     美化     POST /api/themes/save（整个主题对象）
     预设     POST /api/presets/save { apiId, name, preset }
     快回/布局 POST /api/quick-replies/save、POST /api/moving-ui/save
     面具头像 POST /api/avatars/upload（multipart：avatar + overwrite_name）
     背景图   POST /api/backgrounds/upload（multipart：avatar）
     群组     POST /api/groups/create（整个群组对象）
     扩展数据 settings.json 读改写（settings/save 是**整份覆盖写**，所以先 get 回来改几个键再 save）

   ⚠️ 两类**写不回去**，面板和 说明.txt 都写明，不假装成功：
     · instruct / context / sysprompt / reasoning 四类模板文件 —— 酒馆没有写接口（模板库是只读的）
     · settings.json 整份覆盖 —— 会把目标机的接口/密钥一起换掉，只换下面挑的那几个键
   ========================================================================== */
var orbImpZip = null;        // 解开的 JSZip
var orbImpInfo = null;       // { root, manifest, names, present:[类] }
var orbImpPick = {};         // 类别 → 要不要恢复
var orbImpBusy = false;
var orbImpLine = '';
var orbImpResult = null;     // { ok, fail, skip, detail:[] }
var orbImpErr = '';
var orbImpFile = '';
var orbPersonaDel = null;    // 正在等确认删除哪个面具（就地确认，不用酒馆弹窗）

const ORB_IMP_CATS = [
    { id: 'chars', name: '角色卡', hint: '同名卡会被覆盖' },
    { id: 'chats', name: '聊天记录', hint: '按角色名找对应卡，找不到就跳过' },
    { id: 'sprites', name: '表情差分' },
    { id: 'worlds', name: '世界书', hint: '同名书会被覆盖' },
    { id: 'themes', name: '美化', hint: '同名主题会被覆盖' },
    { id: 'presets', name: '预设 · 快捷回复 · 布局预设' },
    { id: 'personas', name: '面具头像' },
    { id: 'groups', name: '群组 · 群聊' },
    { id: 'media', name: '背景图', hint: '最大的一项' },
    { id: 'settings', name: '扩展数据 · 面具文本 · 标签', hint: '只换这几个键，不动你的接口/密钥' },
];
function orbImpPickOf(id) { return orbImpPick[id] !== false; }
function orbImpRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 聊天要按 avatar_url 还原，而包里目录名是**导出时的角色名** —— 得先在角色表里找回来 */
function orbImpAvatarOf(dirName) {
    const chars = ((getContext() || {}).characters) || [];
    const key = String(dirName || '').trim();
    const hit = chars.find(c => c && (String(c.name || '').trim() === key
        || String(c.avatar || '').replace(/\.png$/i, '') === key));
    return hit ? String(hit.avatar || '') : '';
}

function orbImpHTML() {
    let h = '<div style="margin-top:15px;padding-top:11px;border-top:1px solid rgba(255,255,255,.14)">'
        + '<div class="ssp-orb-fl" style="margin-bottom:6px"><span>从备份包恢复</span>'
        + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
        + '<span class="ssp-pbtn" data-orb-dataimportpick="1"><i class="fa-solid fa-folder-open"></i>选择 .zip 备份包</span>'
        + '<input type="file" accept=".zip,application/zip" data-orb-dataimportfile="1" style="display:none">'
        + (orbImpInfo ? '<b style="font-size:11.5px">' + esc(orbImpFile) + '</b>'
            : '<span style="font-size:11px;opacity:.5">只认本扩展导出的包（根下有 manifest.json）</span>')
        + '</div></div>';
    if (orbImpErr) h += '<div class="ssp-orb-empty" style="padding:4px 0;color:#ffb3bb">' + esc(orbImpErr) + '</div>';
    if (orbImpInfo) {
        const m = orbImpInfo.manifest || {};
        const cc = m.counts || {};
        h += '<div class="ssp-orb-empty" style="padding:5px 0 2px">包里：'
            + esc(Object.keys(cc).filter(k => k.indexOf('__') !== 0).map(k => k + ' ' + cc[k]).join(' · '))
            + (m.exportedAt ? '<br>导出于 ' + esc(String(m.exportedAt).replace('T', ' ').slice(0, 19)) + '（面板 ' + esc(m.panelVersion || '?') + '）' : '')
            + '</div>';
        h += '<div class="ssp-orb-fl"><span>恢复哪些（同名会被覆盖）</span>'
            + ORB_IMP_CATS.filter(c => orbImpInfo.present.indexOf(c.id) >= 0).map(c =>
                '<label class="ssp-orb-auto" style="display:flex;margin:3px 0">'
                + '<input type="checkbox" data-orb-datacatimp="' + esc(c.id) + '"' + (orbImpPickOf(c.id) ? ' checked' : '') + '>'
                + '<b style="font-weight:600">' + esc(c.name) + '</b>'
                + (c.hint ? '<span style="opacity:.5">' + esc(c.hint) + '</span>' : '')
                + '</label>').join('') + '</div>';
        if (orbImpInfo.present.indexOf('presets') >= 0) {
            h += '<div class="ssp-orb-empty" style="padding:2px 0 6px">预设 / 指令 / 上下文 / 系统提示 / 推理 / 快捷回复 / 布局预设'
                + '都是**按名字新增或覆盖**（同名覆盖，不同名就是多一条选项）。</div>';
        }
        h += '<div class="ssp-orb-nnew"><span class="ssp-pbtn' + (orbImpBusy ? '' : ' primary') + '" data-orb-datarestore="1">'
            + (orbImpBusy ? '<i class="fa-solid fa-spinner fa-spin"></i>恢复中…' : '<i class="fa-solid fa-rotate-left"></i>开始恢复')
            + '</span></div>';
    }
    if (orbImpBusy || orbImpLine) h += '<div class="ssp-orb-pcount">' + esc(orbImpLine) + '</div>';
    if (orbImpResult) {
        const r = orbImpResult;
        h += '<div class="ssp-orb-empty" style="padding:6px 0">恢复结束：成功 <b>' + r.ok + '</b> · 失败 <b>' + r.fail + '</b> · 跳过 <b>' + r.skip + '</b>'
            + (r.detail.length ? '<br>' + r.detail.slice(0, 8).map(esc).join('<br>') + (r.detail.length > 8 ? '<br>…共 ' + r.detail.length + ' 条' : '') : '')
            + '<br>刷新页面后生效。</div>';
    }
    h += '<div class="ssp-orb-empty" style="padding-top:6px">点「开始恢复」会**先自动导出一份当前数据**'
        + '（下载成 导入前_自动备份_xxx.zip），确认收到后才往下写。</div></div>';
    return h;
}

/** 读包 + 校验：只认本扩展导出的（根下要有 manifest.json，且 tool 对得上） */
async function orbImpRead(file) {
    orbImpErr = ''; orbImpInfo = null; orbImpResult = null; orbImpZip = null; orbImpFile = '';
    if (!file) return false;
    orbImpLine = '正在读包…';
    if (orbOpenNow && orbTab === 'data') renderOrbPanel();
    try {
        const JSZip = await orbDataZipCtor();
        const zip = await JSZip.loadAsync(file);
        const names = Object.keys(zip.files);
        const manPath = names.find(n => /^[^/]*\/manifest\.json$/.test(n)) || names.find(n => n === 'manifest.json');
        if (!manPath) throw new Error('包里没有 manifest.json —— 不是本扩展导出的备份包');
        const man = JSON.parse(await zip.file(manPath).async('string'));
        if (!man || String(man.tool || '').indexOf('鼠鼠小助手') < 0) throw new Error('manifest.json 的 tool 对不上，不是本扩展的包');
        const root = manPath.replace(/manifest\.json$/, '');
        const has = p => names.some(n => n.indexOf(root + p) === 0);
        const present = [];
        if (names.some(n => new RegExp('^' + orbImpRe(root) + 'characters/[^/]+\\.png$', 'i').test(n))) present.push('chars');
        if (names.some(n => new RegExp('^' + orbImpRe(root) + 'characters/[^/]+/[^/]+$').test(n))) present.push('sprites');
        if (has('chats/')) present.push('chats');
        if (has('worlds/')) present.push('worlds');
        if (has('themes/')) present.push('themes');
        if (has('presets/')) present.push('presets');
        if (has('User Avatars/')) present.push('personas');
        if (has('groups/') || has('group chats/')) present.push('groups');
        if (has('backgrounds/')) present.push('media');
        if (names.some(n => n === root + 'settings.json')) present.push('settings');
        orbImpZip = zip;
        orbImpInfo = { root: root, manifest: man, names: names, present: present };
        orbImpPick = {};
        present.forEach(id => { orbImpPick[id] = true; });
        orbImpFile = file.name || '';
        orbImpLine = '';
        toast('读到备份包：' + present.length + ' 类数据可恢复', 'success');
    } catch (e) {
        orbImpErr = '读包失败：' + ((e && e.message) || e);
        orbImpLine = '';
    }
    if (orbOpenNow && orbTab === 'data') renderOrbPanel();
    return !!orbImpInfo;
}

async function orbImpRestore(skipPrep) {
    if (orbImpBusy) { toast('正在恢复了，稍等', 'info'); return false; }
    if (!orbImpZip || !orbImpInfo) { toast('先选一个备份包', 'warning'); return false; }
    const want = ORB_IMP_CATS.filter(c => orbImpInfo.present.indexOf(c.id) >= 0 && orbImpPickOf(c.id)).map(c => c.id);
    if (!want.length) { toast('先勾选要恢复哪几类', 'warning'); return false; }
    const ctx = getContext() || {};
    const hdrs = omit => (ctx.getRequestHeaders ? ctx.getRequestHeaders(omit ? { omitContentType: true } : undefined) : {});
    const root = orbImpInfo.root, Z = orbImpZip, names = orbImpInfo.names;
    const res = { ok: 0, fail: 0, skip: 0, detail: [] };
    let lastPaint = 0;
    const say = s => {
        orbImpLine = s;
        const t = Date.now();
        if (orbOpenNow && orbTab === 'data' && t - lastPaint > 150) { lastPaint = t; renderOrbPanel(); }
    };
    const fail = m => { res.fail += 1; if (res.detail.length < 40) res.detail.push(m); };
    const filesIn = pre => names.filter(n => n.indexOf(root + pre) === 0 && !Z.files[n].dir && n !== root + pre);

    /* ① 写前先自动备份（按同样这几类导当前数据），并让用户确认备份到手。
       skipPrep=true 只给自动化测试用（跳过备份+确认直接写）—— UI 上没有任何入口能传它。 */
    orbImpBusy = true; orbImpResult = null;
    if (!skipPrep) {
    say('先备份当前数据…');
    if (orbOpenNow && orbTab === 'data') renderOrbPanel();
    let bkName = '';
    try {
        const saved = Object.assign({}, orbDataPick);
        Object.keys(orbDataPick).forEach(k => delete orbDataPick[k]);
        want.forEach(k => { orbDataPick[k] = true; });
        const b = await orbDataBuild();
        Object.keys(orbDataPick).forEach(k => delete orbDataPick[k]);
        Object.assign(orbDataPick, saved);
        bkName = b.name;
        orbDataDownload(b.blob, b.name);
    } catch (e) {
        orbImpBusy = false; orbImpLine = '';
        toast('自动备份失败，已中止（没写任何东西）：' + ((e && e.message) || e), 'error');
        if (orbOpenNow && orbTab === 'data') renderOrbPanel();
        return false;
    }
    let go = true;
    if (typeof ctx.callGenericPopup === 'function') {
        const rr = await ctx.callGenericPopup(
            '<h3>恢复前先确认备份</h3><p>已经在下 <b>' + esc(bkName) + '</b>（当前数据的完整备份）。</p>'
            + '<p style="opacity:.75;font-size:.92em">确认文件到了你的下载目录，再点「开始恢复」。<br>'
            + '恢复会按勾选的类别<b>覆盖同名数据</b>，覆盖后不可撤销。</p>',
            (ctx.POPUP_TYPE && ctx.POPUP_TYPE.CONFIRM) || 2, '',
            { okButton: '备份收到了，开始恢复', cancelButton: '先停一下' });
        const R = ctx.POPUP_RESULT || {};
        go = (rr === (R.AFFIRMATIVE || 1)) || rr === true;
    }
    if (!go) {
        orbImpBusy = false; orbImpLine = '';
        toast('已取消，没写任何东西', 'info');
        if (orbOpenNow && orbTab === 'data') renderOrbPanel();
        return false;
    }
    }

    /* ② 角色卡（带 preserved_name → 覆盖同名卡；卡不存在就用这个名字新建） */
    if (want.indexOf('chars') >= 0) {
        const list = names.filter(n => new RegExp('^' + orbImpRe(root) + 'characters/[^/]+\\.png$', 'i').test(n) && !Z.files[n].dir);
        for (const n of list) {
            const av = n.split('/').pop();
            say('角色卡：' + av);
            try {
                const blob = await Z.file(n).async('blob');
                await importPost(new File([blob], av, { type: 'image/png' }), av.replace(/\.png$/i, ''));
                res.ok += 1;
            } catch (e) { fail('角色卡 ' + av + '：' + ((e && e.message) || e)); }
        }
        try { if (ctx.getCharacters) await ctx.getCharacters(); } catch (e) { }   // 后面聊天要按名字找卡
    }

    /* ③ 表情差分：characters/<角色文件夹>/<图> → /api/sprites/upload */
    if (want.indexOf('sprites') >= 0) {
        const list = names.filter(n => new RegExp('^' + orbImpRe(root) + 'characters/[^/]+/[^/]+$').test(n) && !Z.files[n].dir);
        for (const n of list) {
            const parts = n.split('/'); const f = parts.pop(); const folder = parts.pop();
            const label = f.replace(/\.[^.]+$/, '').toLowerCase();
            say('表情：' + folder + ' / ' + f);
            try {
                const blob = await Z.file(n).async('blob');
                const fd = new FormData();
                fd.append('name', folder);
                fd.append('label', label);
                fd.append('avatar', new File([blob], f, { type: 'image/png' }));
                fd.append('spriteName', label);
                const r = await fetch('/api/sprites/upload', { method: 'POST', headers: hdrs(true), body: fd, cache: 'no-cache' });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('表情 ' + folder + '/' + f + '：' + ((e && e.message) || e)); }
        }
    }

    /* ④ 聊天记录：chats/<角色名>/<文件>.jsonl → /api/chats/import（要先找到对应的角色文件名） */
    if (want.indexOf('chats') >= 0) {
        let chatRestored = 0;
        const list = names.filter(n => new RegExp('^' + orbImpRe(root) + 'chats/[^/]+/[^/]+$').test(n) && !Z.files[n].dir);
        for (const n of list) {
            const parts = n.split('/'); const f = parts.pop(); const dir = parts.pop();
            say('聊天：' + dir + ' / ' + f);
            const av = orbImpAvatarOf(dir);
            if (!av) { res.skip += 1; if (res.detail.length < 40) res.detail.push('聊天 ' + dir + '/' + f + '：没找到同名角色卡，跳过'); continue; }
            try {
                const text = await Z.file(n).async('string');
                /* ⚠️ 别用 /api/chats/import —— 那个是给**外来格式**（Chub/CAI 等）用的：
                   它会自己改名成「xxx imported.jsonl」，还原不了原始文件名，实测还回 500。
                   正路是 /api/chats/save：把 jsonl 拆成数组喂它，file_name 由我给（不带 .jsonl），
                   带 force:true 覆盖（不然 integrity 校验会拦）。 */
                const chat = String(text).split('\n').map(l => l.trim()).filter(Boolean)
                    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
                if (!chat.length) throw new Error('文件是空的');
                const r = await fetch('/api/chats/save', {
                    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                    body: JSON.stringify({
                        avatar_url: av, file_name: f.replace(/\.jsonl$/i, ''), chat: chat, force: true,
                    }),
                    cache: 'no-cache',
                });
                if (!r.ok) {
                    const t = await r.text().catch(() => '');
                    throw new Error('HTTP ' + r.status + ' ' + String(t).slice(0, 70));
                }
                res.ok += 1;
                chatRestored += 1;
            } catch (e) { fail('聊天 ' + f + '：' + ((e && e.message) || e)); }
        }
    }

    /* ⚠️ 聊天恢复是**带 force 覆盖写文件**的 —— 酒馆保存时会拿"客户端内存里的完整性哈希"
       跟磁盘比（chats.js 的 trySaveChat），文件被外部重写过就会**拒绝保存**
       （表现：一直弹"聊天无法保存"）。所以这里明确提醒刷新一次，让酒馆重新读盘对齐。
       （我自己测导入时踩过：那份开着的老会话之后每次保存都被拒。） */
    if (chatRestored > 0) {
        res.detail.push('聊天记录已恢复：**请刷新一次页面**（酒馆的完整性校验要对齐，否则会一直提示存不上）');
    }

    /* ⑤ 世界书 */    if (want.indexOf('worlds') >= 0) {
        for (const n of filesIn('worlds/')) {
            const nm = n.split('/').pop().replace(/\.json$/i, '');
            say('世界书：' + nm);
            try {
                const data = JSON.parse(await Z.file(n).async('string'));
                const r = await fetch('/api/worldinfo/edit', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                    body: JSON.stringify({ name: nm, data: data }), cache: 'no-cache',
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('世界书 ' + nm + '：' + ((e && e.message) || e)); }
        }
    }

    /* ⑥ 美化（整个主题对象丢给 themes/save） */
    if (want.indexOf('themes') >= 0) {
        for (const n of filesIn('themes/')) {
            const nm = n.split('/').pop().replace(/\.json$/i, '');
            say('美化：' + nm);
            try {
                const t = JSON.parse(await Z.file(n).async('string'));
                t.name = String(t.name || nm);
                const r = await fetch('/api/themes/save', {
                    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                    body: JSON.stringify(t), cache: 'no-cache',
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('美化 ' + nm + '：' + ((e && e.message) || e)); }
        }
    }

    /* ⑦ 预设 / 模板 / 快捷回复 / 布局预设 */
    if (want.indexOf('presets') >= 0) {
        /* ⚠️ /api/presets/save 的 apiId 取值是酒馆内部那套，不是目录名：
             NovelAI → 'novel'、KoboldAI → 'kobold'（我一开始写成 novelai/koboldai，全 400）。
             而且 instruct / context / sysprompt / reasoning **也走这个接口**（文件夹+扩展名都在里面配好了）
             —— 所以那四类模板其实是能写回去的，之前以为不能是错的。 */
        const API_ID = {
            openai: 'openai', textgen: 'textgenerationwebui', novelai: 'novel', koboldai: 'kobold',
            instruct: 'instruct', context: 'context', sysprompt: 'sysprompt', reasoning: 'reasoning',
        };
        for (const n of filesIn('presets/')) {
            const parts = n.split('/'); const f = parts.pop(); const sub = parts.pop();
            if (!f || /\/$/.test(n)) continue;
            const nm = f.replace(/\.json$/i, '');
            if (!API_ID[sub]) {
                res.skip += 1;
                if (res.detail.length < 12) res.detail.push('模板 ' + sub + '/' + nm + '：不认识的目录，跳过');
                continue;
            }
            /* 防线：老版本导出 bug 留下的包里，预设文件名是**整段 JSON**（`{ ...` / `_n __temp__` 那种）。
               这种条目绝不能写成文件 —— 一旦漏进去，预设目录里就多一堆垃圾选项（真踩过，删了 28 个）。 */
            if (/^[_{]/.test(nm) || nm.indexOf('__') >= 0 || nm.length > 100) {
                res.skip += 1;
                if (res.detail.length < 12) res.detail.push('模板 ' + sub + '/' + nm.slice(0, 24) + '…：名字像 JSON 块（旧版导出的 bug），跳过');
                continue;
            }
            say('预设：' + sub + ' / ' + nm);
            try {
                const preset = JSON.parse(await Z.file(n).async('string'));
                const r = await fetch('/api/presets/save', {
                    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                    body: JSON.stringify({ apiId: API_ID[sub], name: nm, preset: preset }), cache: 'no-cache',
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('预设 ' + sub + '/' + nm + '：' + ((e && e.message) || e)); }
        }
        for (const n of filesIn('presets/quickreplies/')) {
            const nm = n.split('/').pop().replace(/\.json$/i, '');
            say('快捷回复：' + nm);
            try {
                const q = JSON.parse(await Z.file(n).async('string'));
                const r = await fetch('/api/quick-replies/save', {
                    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                    body: JSON.stringify(q), cache: 'no-cache',
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('快捷回复 ' + nm + '：' + ((e && e.message) || e)); }
        }
        for (const n of filesIn('presets/movingUI/')) {
            const nm = n.split('/').pop().replace(/\.json$/i, '');
            say('布局预设：' + nm);
            try {
                const m = JSON.parse(await Z.file(n).async('string'));
                const r = await fetch('/api/moving-ui/save', {
                    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                    body: JSON.stringify(m), cache: 'no-cache',
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('布局预设 ' + nm + '：' + ((e && e.message) || e)); }
        }
    }

    /* ⑧ 面具头像 */
    if (want.indexOf('personas') >= 0) {
        for (const n of filesIn('User Avatars/')) {
            const nm = n.split('/').pop();
            say('面具头像：' + nm);
            try {
                const blob = await Z.file(n).async('blob');
                const fd = new FormData();
                fd.append('avatar', new File([blob], nm, { type: 'image/png' }));
                fd.append('overwrite_name', nm);
                const r = await fetch('/api/avatars/upload', { method: 'POST', headers: hdrs(true), body: fd, cache: 'no-cache' });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('头像 ' + nm + '：' + ((e && e.message) || e)); }
        }
    }

    /* ⑨ 背景图 */
    if (want.indexOf('media') >= 0) {
        for (const n of filesIn('backgrounds/')) {
            const nm = n.split('/').pop();
            say('背景图：' + nm);
            try {
                const blob = await Z.file(n).async('blob');
                const fd = new FormData();
                fd.append('avatar', new File([blob], nm, { type: blob.type || 'image/png' }));
                fd.append('overwrite_name', nm);
                const r = await fetch('/api/backgrounds/upload', { method: 'POST', headers: hdrs(true), body: fd, cache: 'no-cache' });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('背景 ' + nm + '：' + ((e && e.message) || e)); }
        }
    }

    /* ⑩ 群组（整份丢 groups/create） */
    if (want.indexOf('groups') >= 0) {
        for (const n of filesIn('groups/')) {
            const nm = n.split('/').pop().replace(/\.json$/i, '');
            say('群组：' + nm);
            try {
                const g = JSON.parse(await Z.file(n).async('string'));
                const r = await fetch('/api/groups/create', {
                    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                    body: JSON.stringify(g), cache: 'no-cache',
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                res.ok += 1;
            } catch (e) { fail('群组 ' + nm + '：' + ((e && e.message) || e)); }
        }
        const gc = filesIn('group chats/').length;
        if (gc) { res.skip += gc; res.detail.push('群聊 ' + gc + ' 份：群组要先在酒馆里认出来才会归位，这版先跳过'); }
    }

    /* ⑪ 扩展数据 / 面具文本 / 标签：settings.json 读改写，只动这几个键 */
    if (want.indexOf('settings') >= 0) {
        say('合并扩展数据…');
        try {
            const cur = await orbDataPost('/api/settings/get', {});
            const live = JSON.parse(typeof cur.settings === 'string' ? cur.settings : JSON.stringify(cur.settings));
            const pkg = JSON.parse(await Z.file(root + 'settings.json').async('string'));
            const merged = [];
            if (pkg.power_user) {
                ['personas', 'persona_descriptions'].forEach(k => {
                    if (pkg.power_user[k] && typeof pkg.power_user[k] === 'object') {
                        live.power_user = live.power_user || {};
                        live.power_user[k] = Object.assign({}, live.power_user[k] || {}, pkg.power_user[k]);
                        merged.push('power_user.' + k);
                    }
                });
            }
            ['tags', 'tag_map'].forEach(k => {
                if (pkg[k] !== undefined) { live[k] = pkg[k]; merged.push(k); }
            });
            const sp = pkg.extension_settings && pkg.extension_settings[MODULE_NAME];
            if (sp && typeof sp === 'object') {
                live.extension_settings = live.extension_settings || {};
                live.extension_settings[MODULE_NAME] = sp;
                merged.push('extension_settings.' + MODULE_NAME);
            }
            const r = await fetch('/api/settings/save', {
                method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
                body: JSON.stringify(live), cache: 'no-cache',
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            res.ok += 1;
            res.detail.unshift('已合并：' + merged.join('、') + '（刷新页面生效）');        } catch (e) { fail('扩展数据：' + ((e && e.message) || e)); }
    }

    orbImpResult = res;
    orbImpBusy = false; orbImpLine = '';
    toast('恢复结束：成功 ' + res.ok + ' · 失败 ' + res.fail + (res.skip ? ' · 跳过 ' + res.skip : ''), res.fail ? 'warning' : 'success');
    if (orbOpenNow && orbTab === 'data') renderOrbPanel();
    return res;   // 返回值给自动化测试用（UI 不看它）
}

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
    const f = orbElFile(sel);
    if (f) return f;
    try { return (getContext().powerUserSettings || {}).default_persona || ''; } catch (e) { return ''; }
}

function orbPersonaThumb(id) { return '/thumbnail?type=persona&file=' + encodeURIComponent(id); }

/** 选一个面具：点酒馆自己列表里对应那一项 */
/** 从一个 <img>/元素上认出它的文件名。
    优先读高清替换时留的记号（dataset.sspFile）—— 因为 src 可能已经被换成原图路径了；
    退路：原生缩略图 ?file=xxx、或已经是原图的 /User%20Avatars/xxx、/characters/xxx。 */
function orbElFile(el) {
    if (!el) return '';
    try {
        if (el.dataset && el.dataset.sspFile) return el.dataset.sspFile;
        const src = (el.getAttribute ? (el.getAttribute('src') || '') : '');
        const m = /[?&]file=([^&]+)/.exec(src);
        if (m) return decodeURIComponent(m[1]);
        const m2 = /\/(?:User%20Avatars|User Avatars|characters)\/([^/?#]+)/.exec(src);
        if (m2) return decodeURIComponent(m2[1]);
    } catch (e) { }
    return '';
}

function orbPersonaSwitch(id) {
    const items = Array.from(document.querySelectorAll('#user_avatar_block .avatar-container'));
    for (const c of items) {
        const img = c.querySelector('img');
        if (orbElFile(img) === id) {
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
        /* ⚠️ overwrite_name 就是**最终文件名**（服务端：sanitize(overwrite_name || Date.now()+'.png')），
           传面具名进去会存成「若语君」这种**没有后缀**的文件 → mime 不是图片 →
           酒馆的「用户设定」根本不渲染它（用户反馈的"创建了之后找不到"就是这个）。
           所以这里自己拼一个带 .png 的安全文件名，面具 id 也用同一个（跟酒馆一致：id 都是 xxx.png）。 */
        const id = (String(nm).replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '').trim() || 'persona') + '.png';
        const fd = new FormData();
        fd.append('avatar', file);
        fd.append('overwrite_name', id);
        const res = await fetch('/api/avatars/upload', {
            method: 'POST',
            headers: ctx.getRequestHeaders({ omitContentType: true }),
            body: fd,
        });
        if (!res.ok) { toast('创建失败：' + res.status, 'warning'); return null; }
        const data = await res.json().catch(() => ({}));
        /* 服务端回的是裸文件名（不是 URL）；拿不到就用我们拼的那个 */
        const made = String((data && data.path) || '');
        const finalId = made && /\.(png|jpg|jpeg|webp|gif)$/i.test(made) ? made : id;
        /* 写进酒馆的面具数据（等于 initPersona 做的事） */
        const pu = ctx.powerUserSettings;
        if (!pu.personas) pu.personas = {};
        pu.personas[finalId] = nm;
        if (!pu.persona_descriptions) pu.persona_descriptions = {};
        pu.persona_descriptions[finalId] = { description: String(desc || ''), position: 0, connections: [] };
        save();
        /* 通知酒馆（它会刷新自己的面具列表）——
           ⚠️ 实测这个 build 里 **没有任何 PERSONA_CREATED 的监听者**（全 public 搜过），
              酒馆是在打开「用户设定」时自己 getUserAvatars() 重画的，所以 emit 只是尽人事。
              真正让列表出现的是"文件名带上了后缀"这件事本身。 */
        try { if (ctx.eventSource && ctx.eventTypes && ctx.eventTypes.PERSONA_CREATED) await ctx.eventSource.emit(ctx.eventTypes.PERSONA_CREATED, { avatarId: finalId, name: nm, description: String(desc || '') }); } catch (e) { }
        toast('已新建面具：' + nm + '（打开一次「用户设定」就能看到）', 'success');
        return finalId;
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
        const dlcN = dlcPersonaEntryCount(p.id);          // v1.31.59：只读显示"这个面具挂了哪几条 DLC"
        const chatN = personaChatCount(p.id);             // v1.31.64：只读显示"这个面具绑了几份存档"
        return '<div class="ssp-orb-prow' + (on ? ' on' : '') + '">'
            + '<img class="ssp-orb-pav" src="' + orbPersonaThumb(p.id) + '" data-orb-persona="' + esc(p.id) + '" title="点头像换面具" alt="">'
            + '<div class="ssp-orb-pmain">'
            + '<div class="ssp-orb-pname">' + esc(p.name) + (on ? '<span class="ssp-orb-ptag">当前</span>' : '') + '</div>'
            + '<div class="ssp-orb-pdesc">' + (desc ? esc(desc.slice(0, 80)) + (desc.length > 80 ? '…' : '') : '<i>没写描述</i>') + '</div>'
            + '<div class="ssp-orb-pbind' + (bound ? ' has' : '') + '"><i class="fa-solid fa-link"></i>' + (bound ? esc(bound) : '未绑定角色') + '</div>'
            + (chatN ? '<div class="ssp-orb-pbind has"><i class="fa-solid fa-box-archive"></i>存档：绑 ' + chatN + ' 份</div>' : '')
            + (dlcN ? '<div class="ssp-orb-pbind has"><i class="fa-solid fa-masks-theater"></i>DLC 条目：挂 ' + dlcN + ' 条</div>' : '')
            + '</div>'
            + '<div class="ssp-orb-pacts">'
            + '<span class="ssp-pbtn' + (on ? ' primary' : '') + '" data-orb-persona="' + esc(p.id) + '">' + (on ? '当前' : '换成这个') + '</span>'
            + '<span class="ssp-pbtn" data-orb-bind="' + esc(p.id) + '"><i class="fa-solid fa-link"></i>绑定</span>'
            + '<span class="ssp-pbtn" data-orb-pedit="' + esc(p.id) + '"><i class="fa-solid fa-pen"></i>编辑</span>'
            + '<span class="ssp-pbtn danger" data-orb-pdel="' + esc(p.id) + '" title="删掉这个面具（会先问一次）">'
            + '<i class="fa-solid fa-trash-can"></i>删</span>'
            + '</div></div>'
            /* 就地确认（这个 build 的 callGenericPopup(CONFIRM) 是隐形的，不能用它） */
            + (String(orbPersonaDel) === String(p.id)
                ? '<div class="ssp-en-confirm">'
                + '<span class="ssp-en-confirm-t">删掉面具「' + esc(p.name) + '」？<b>头像文件一起删</b>，删了找不回来。</span>'
                + '<span class="ssp-pbtn danger" data-orb-pdelgo="' + esc(p.id) + '"><i class="fa-solid fa-trash"></i>确认删掉</span>'
                + '<span class="ssp-pbtn" data-orb-pdelcancel="1">算了</span>'
                + '</div>'
                : '');
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

/** 删面具：从酒馆的面具数据里摘掉 + 删掉头像文件 + 把 ST 自己的列表里那一条也拔掉。
    ⚠️ 三个地方都要动，少一个就会留残渣：
      · power_user.personas / persona_descriptions（列表靠它）
      · User Avatars/<id>（文件不删永远占着，下次同名还会撞）
      · 当前聊天/默认面具如果正指着它 → 清掉引用，不然酒馆会指着一个不存在的人
    删文件走酒馆自己的 /api/avatars/delete（它顺带清缩略图）。 */
async function orbPersonaDelete(id) {
    const pid = String(id || '');
    if (!pid) return false;
    const ctx = getContext();
    const pu = ctx.powerUserSettings || {};
    const nm = (pu.personas && pu.personas[pid]) || pid;
    try {
        /* 1) 先摘引用，别让酒馆指着一个马上要没的人 */
        const wasActive = (String(orbActivePersona()) === pid);
        if (pu.default_persona === pid) {
            const rest = Object.keys(pu.personas || {}).filter(k => k !== pid);
            pu.default_persona = rest.length ? rest[0] : null;
        }
        try {
            if (ctx.chatMetadata && String(ctx.chatMetadata.persona || '') === pid) ctx.chatMetadata.persona = '';
        } catch (e) { }
        /* 2) 摘掉两处数据 */
        if (pu.personas) delete pu.personas[pid];
        if (pu.persona_descriptions) delete pu.persona_descriptions[pid];
        save();
        /* 3) 删头像文件（失败不中断，数据已经摘干净了） */
        let fileOk = true;
        try {
            const r = await fetch('/api/avatars/delete', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, (ctx.getRequestHeaders ? ctx.getRequestHeaders() : {})),
                body: JSON.stringify({ avatar: pid }),
                cache: 'no-cache',
            });
            /* 404 = 文件本来就不在（比如设置里留了个指向已删文件的空键）→ 这不算失败 */
            fileOk = !!(r && (r.ok || r.status === 404));
        } catch (e) { fileOk = false; }
        /* 4) 拔掉酒馆自己列表里的那一条（省得还要刷新才消失） */
        try {
            document.querySelectorAll('#user_avatar_block .avatar-container').forEach(c => {
                const img = c.querySelector('img');
                if (orbElFile(img) === pid) c.remove();
            });
        } catch (e) { }
        try { if (ctx.eventSource && ctx.eventTypes && ctx.eventTypes.PERSONA_DELETED) await ctx.eventSource.emit(ctx.eventTypes.PERSONA_DELETED, { avatarId: pid }); } catch (e) { }
        toast('已删掉面具：' + nm + (fileOk ? '' : '（头像文件没删掉，可以手动去 User Avatars 里删）')
            + (wasActive ? '；它原来是当前面具，记得换一个' : ''), fileOk ? 'success' : 'warning');
        return true;
    } catch (e) {
        toast('删除失败：' + ((e && e.message) || e), 'error');
        return false;
    }
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
                if (orbElFile(img) === id) {
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

/* ---------------------------- 面具 ↔ 存档 绑定（v1.31.64）---------------------------
   用户要的：「面具绑定存档」—— 现在能绑角色卡，但一份存档换不出不同的面具。

   数据分两层（都不改别人的聊天文件）：
     ① 我这边：`s.personaChatBinds['角色头像::存档文件名'] = 面具id`（意图表，跟酒馆备份走）
     ② 酒馆原生：那份存档自己 metadata 里的 `persona`（效果；切过去时由**酒馆自己**保存）
   优先级：**存档 > 角色卡 > 默认**（原生就是这个顺序，我只补"存档"这一层）。
   ⚠️ 存档里如果本来就锁着别的面具（你自己在酒馆点的），**以原生为准、不覆盖** —— 只提示一句。
   ------------------------------------------------------------------------------------ */
var personaBindTab = 'char';      // 面具页「绑定」弹层里的分组：char（角色卡）| chat（存档）
var personaChatMaskKey = '';      // 存档页 🎭：正在给哪份存档挑面具
var personaChatApplied = '';      // 刚自动应用过的存档（只在弹提示时去重用）

function personaChatBinds() {
    const s = getSettings();
    if (!s.personaChatBinds || typeof s.personaChatBinds !== 'object' || Array.isArray(s.personaChatBinds)) s.personaChatBinds = {};
    return s.personaChatBinds;
}
/** 存档键：角色头像 + 存档文件名（去掉 .jsonl） */
function personaChatKeyOf(avatar, file) {
    const a = String(avatar || '');
    const f = String(file || '').replace(/\.jsonl$/i, '');
    return a && f ? (a + '::' + f) : '';
}
function personaChatKeyCur() {
    const ch = orbChatChar();
    if (!ch) return '';
    return personaChatKeyOf(ch.avatar, orbCurChatId());
}
function personaChatBindOf(key) {
    const v = personaChatBinds()[String(key || '')];
    return typeof v === 'string' ? v : '';
}
/** 绑 / 解绑（返回 true = 现在绑上了） */
function personaChatBindSet(key, pid) {
    const b = personaChatBinds();
    const k = String(key || '');
    if (!k) return false;
    if (pid) b[k] = pid; else delete b[k];
    save();
    return Boolean(pid);
}
/** 这个面具挂着几份存档 */
function personaChatCount(pid) {
    const b = personaChatBinds();
    return Object.keys(b).filter(k => b[k] === pid).length;
}
/** 这份存档自己（酒馆原生）锁着谁 */
function personaChatNative() {
    try {
        const md = (getContext() || {}).chatMetadata || {};
        return typeof md.persona === 'string' ? md.persona : '';
    } catch (e) { return ''; }
}
/** 切开到某份存档时自动应用：把表里的面具戴上 + 写进原生 metadata（由酒馆自己保存） */
function personaChatApply(silent) {
    try {
        const key = personaChatKeyCur();
        if (!key) return false;
        const want = personaChatBindOf(key);
        if (!want) return false;
        const ctx = getContext() || {};
        const md = ctx.chatMetadata || {};
        const native = typeof md.persona === 'string' ? md.persona : '';
        if (native && native !== want) {
            if (!silent) toast('这份存档自己锁着「' + dlcPersonaName(native) + '」，没动它（我这边配的是「' + dlcPersonaName(want) + '」）', 'info');
            return false;
        }
        /* ⚠️ "现在真戴着谁"必须**在写 metadata 之前**取：dlcWornPersona() 优先读 chat_metadata.persona，
           先写再取就会读到刚写进去的值，于是以为"已经戴上了"，**根本不会去换面具**（实测踩到）。 */
        const worn = dlcWornPersona();
        if (!native) {
            try { md.persona = want; ctx.saveMetadataDebounced?.(); } catch (e) { }
        }
        if (worn !== want) { try { orbPersonaSwitch(want); } catch (e) { } }
        if (personaChatApplied !== key) {
            personaChatApplied = key;
            toast('这份存档锁着：' + dlcPersonaName(want), 'success');
        }
        return true;
    } catch (e) { return false; }
}

/** 存档页里「给这份存档挑面具」那一页（整页替换存档列表，跟 DLC 那套一样） */
function orbChatMaskPickerHTML(key) {
    const ch = orbChatChar();
    const k = String(key || '');
    const bound = personaChatBindOf(k);
    const native = personaChatNative();
    const curKey = personaChatKeyCur();
    const file = k.split('::')[1] || '';
    const all = orbPersonas();
    const rows = all.length ? all.map(p => {
        const on = bound === p.id;
        return '<div class="ssp-orb-charrow' + (on ? ' on' : '') + '" data-orb-chatmaskid="' + esc(p.id) + '">'
            + '<img src="' + orbPersonaThumb(p.id) + '" alt="">'
            + '<span class="ssp-orb-charn">' + esc(p.name) + '</span>'
            + '<span class="ssp-orb-charmark">' + (on ? '<i class="fa-solid fa-check"></i> 已绑' : '<i class="fa-regular fa-circle"></i>') + '</span>'
            + '</div>';
    }).join('') : '<div class="ssp-orb-empty">读不到面具列表 —— 先在酒馆里打开一次「用户设定」。</div>';
    return '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-chatmaskback="1"><i class="fa-solid fa-arrow-left"></i>回存档</span>'
        + '<b>🎭 ' + esc(file || k) + '</b>'
        + (bound ? '<span class="ssp-pbtn danger" data-orb-chatmaskclear="1">清空</span>' : '')
        + '</div>'
        + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">'
        + '给这份存档点一个面具：<b>切到它时自动戴上</b>（存档优先于角色卡）。<br>'
        + (k === curKey
            ? '<b>这就是当前打开的存档</b> —— 点完会立刻写进它的 metadata。'
            : '它不是当前存档：先记着，等你切过去的时侯再生效。')
        + (native ? '<br>它现在（酒馆原生）锁着：<b>' + esc(dlcPersonaName(native)) + '</b>' : '')
        + '</div>'
        + '<div class="ssp-orb-charrows">' + rows + '</div>';
}

function orbBindPickerHTML(id) {
    const p = orbPersonas().find(x => x.id === id) || { name: id };
    const tabBar = '<div class="ssp-orb-pcount">'
        + '<span class="ssp-pbtn' + (personaBindTab === 'char' ? ' primary' : '') + '" data-orb-bindtab="char">角色卡</span>'
        + '<span class="ssp-pbtn' + (personaBindTab === 'chat' ? ' primary' : '') + '" data-orb-bindtab="chat">存档</span>'
        + '</div>';
    const head = '<div class="ssp-orb-bindhead">'
        + '<span class="ssp-pbtn" data-orb-bindback="1"><i class="fa-solid fa-arrow-left"></i>返回</span>'
        + '<b>' + esc(p.name) + ' · 绑定' + (personaBindTab === 'chat' ? '存档' : '角色卡') + '</b>'
        + (personaBindTab === 'chat' ? '' : '<span class="ssp-pbtn danger" data-orb-bindclear="' + esc(id) + '">清空</span>')
        + '</div>';
    if (personaBindTab === 'chat') {
        const ch = orbChatChar();
        const body = !ch
            ? '<div class="ssp-orb-empty">先在酒馆里打开一个角色聊天，这里才会列出它的存档。</div>'
            : (orbChatLoading ? '<div class="ssp-orb-empty">正在读存档列表…</div>'
                : (orbChatErr ? '<div class="ssp-orb-empty">' + esc(orbChatErr) + '</div>'
                    : (orbChatList.length ? orbChatList.map(x => {
                        const key = personaChatKeyOf(ch.avatar, x.file);
                        const mine = personaChatBindOf(key) === id;
                        const other = personaChatBindOf(key);
                        const cur = (x.name === orbCurChatId());
                        return '<div class="ssp-orb-charrow' + (mine ? ' on' : '') + '" data-orb-bindchat="' + esc(key) + '">'
                            + '<span class="ssp-orb-charn">' + esc(x.name) + (cur ? ' <i class="ssp-orb-ptag">当前</i>' : '')
                            + (other && !mine ? '<i class="ssp-en-masknote">（绑给了 ' + esc(dlcPersonaName(other)) + '）</i>' : '')
                            + '</span>'
                            + '<span class="ssp-orb-charmark">' + (mine ? '<i class="fa-solid fa-check"></i> 已绑' : '<i class="fa-regular fa-circle"></i>') + '</span>'
                            + '</div>';
                    }).join('') : '<div class="ssp-orb-empty">这个角色还没有存档（酒馆里聊过就会有）。</div>'))); 
        return head + tabBar
            + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">点一份存档＝让它用这个面具（<b>存档优先于角色卡</b>）；'
            + '再点一下＝解绑。切到那份存档时会自动戴上。</div>'
            + body;
    }
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
    return head + tabBar
        + '<div class="ssp-orb-empty" style="padding:2px 2px 6px">点角色＝绑定/取消；跟已绑定的角色聊天时，酒馆会自动戴上这个面具。</div>'
        + '<div class="ssp-orb-charrows">' + rows + '</div>';
}

function orbNotesHTML() {
    /* 分类标签栏（通用构造器，世界书那边共用） */
    const cats = orbNoteCatNames();
    const all = orbNotes();
    const catCounts = { [ORB_CAT_ALL]: all.length, '': orbNoteCatCount('') };
    cats.forEach(c => { catCounts[c] = orbNoteCatCount(c); });
    const catBar = orbCatBarHTML({
        cats, active: orbNCat, edit: orbNCatEdit, counts: catCounts,
        D: 'data-orb-cat', P: 'data-orb-catpick', S: 'data-orb-catset',
        A: 'data-orb-catadd', E: 'data-orb-catedit', R: 'data-orb-catrename', X: 'data-orb-catdel',
        kind: 'notes',      // 番外的分类：DOM 带这个标记，点击时不用猜在哪一页
    });
    /* 在某个分类标签下新建 → 提示会归进那个分类（用户要的"直接在标签页里新增"） */
    const inCat = (orbNCat && orbNCat !== ORB_CAT_ALL);
    return '<div class="ssp-orb-pfilter">'
        + '<i class="fa-solid fa-magnifying-glass"></i>'
        + '<input class="ssp-inp" type="text" data-orb-nsearch="1" placeholder="搜番外标题 / 正文" value="' + esc(orbNSearch) + '">'
        + (orbNSearch ? '<span class="ssp-pbtn" data-orb-nclear="1">清除</span>' : '')
        + '</div>'
        + catBar
        /* ⚠️ 这个按钮**必须留在列表外面**：搜索时只重画 #ssp_orb_notes_list，
           放进去的话每敲一个字按钮就跟着重建，点击/焦点都会被打断。
           用户反馈"新建在底下太麻烦"（原来钉在面板最底部，存完要滑到底才能再点）→ 已移到列表上面。 */
        + '<div class="ssp-orb-nnew">'
        + (inCat ? '<span class="ssp-orb-nhint">新建的会归到「' + esc(orbNCat) + '」</span>' : '')
        + '<span class="ssp-pbtn primary" data-orb-act="new"><i class="fa-solid fa-plus"></i>新的一条</span></div>'
        + '<div id="ssp_orb_notes_list">' + orbNoteRowsHTML() + '</div>';
}

/** 一条番外是否命中搜索（标题 + 正文都算） */
function orbNoteMatch(n, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    return String(n.title || '').toLowerCase().indexOf(s) >= 0
        || String(n.text || '').toLowerCase().indexOf(s) >= 0;
}

/** 番外列表（搜索时只重画这一块，输入框不丢焦点） */
function orbNoteRowsHTML() {
    const all = orbNotes();
    if (!all.length) return '<div class="ssp-orb-empty">还没有番外。点上面的「＋ 新的一条」就能存了 —— 存好之后可以一键复制，或者直接插进输入框。</div>';
    /* 先按分类标签过滤，再按搜索词过滤 */
    const inCat = all.filter(n => orbNCat === ORB_CAT_ALL ? true
        : (orbNCat === '' ? !orbNoteCatOf(n) : orbNoteCatOf(n) === orbNCat));
    const hit = inCat.filter(n => orbNoteMatch(n, orbNSearch));
    if (!hit.length) {
        if (orbNSearch) return '<div class="ssp-orb-empty">没有匹配「' + esc(orbNSearch) + '」的番外。<br>（搜的是：标题 / 正文）</div>';
        if (orbNCat === '') return '<div class="ssp-orb-empty">所有番外都分好类了。<br>（点番外下面那个 <i class="fa-solid fa-folder"></i> 能把它从分类里拿出来）</div>';
        return '<div class="ssp-orb-empty">「' + esc(orbNCat) + '」里还没有番外。<br>（在这里点「＋ 新的一条」就会自动归进这一类）</div>';
    }
    const head = (orbNSearch || orbNCat !== ORB_CAT_ALL)
        ? '<div class="ssp-orb-pcount">' + (orbNCat !== ORB_CAT_ALL ? '「' + esc(orbNCat || '未分类') + '」' : '')
            + (orbNSearch ? '筛出 ' : '共 ') + hit.length + ' / ' + all.length + ' 条</div>'
        : '';
    const allCats = orbNoteCatNames();
    return head + hit.map(n => {
        const cat = orbNoteCatOf(n);
        const picker = (orbNCatPick === n.id)
            ? orbCatPickHTML({ book: n.id, cats: allCats, cur: cat, P: 'data-orb-catpick', S: 'data-orb-catset', kind: 'notes' })
            : (orbNCatNew === n.id ? orbCatNewHTML({ at: n.id, hint: '新分类叫什么（比如：日常 / 灵感）…', kind: 'notes' }) : '');
        return '<div class="ssp-orb-notewrap' + (picker ? ' picking' : '') + '">'
            + '<div class="ssp-orb-note" data-orb-note="' + esc(n.id) + '">'
            + '<div class="ssp-orb-note-h"><b>' + esc(n.title || '(没写标题)') + '</b>'
            + (cat ? '<span class="ssp-orb-note-cat">' + esc(cat) + '</span>' : '')
            + '<span class="ssp-orb-note-t">' + new Date(n.at || Date.now()).toLocaleDateString() + '</span></div>'
            + '<div class="ssp-orb-note-b">' + esc(String(n.text || '').slice(0, 160)) + (String(n.text || '').length > 160 ? '…' : '') + '</div>'
            + '<div class="ssp-orb-note-a">'
            + '<span class="ssp-pbtn ssp-note-catbtn' + (cat ? ' has' : '') + '" data-orb-catpick="' + esc(n.id) + '"'
            + ' data-orb-catkind="notes"'      // ⚠️ 少了这个标记，点击会被当成世界书那边的（踩过）
            + ' title="' + (cat ? '在分类「' + esc(cat) + '」里 —— 点一下改' : '归到一个分类（文件夹）') + '">'
            + '<i class="fa-solid ' + (cat ? 'fa-folder-open' : 'fa-folder') + '"></i>分类</span>'
            + '<span class="ssp-pbtn" data-orb-act="copy" data-id="' + esc(n.id) + '"><i class="fa-solid fa-copy"></i>复制</span>'
            + '<span class="ssp-pbtn" data-orb-act="insert" data-id="' + esc(n.id) + '"><i class="fa-solid fa-arrow-right-to-bracket"></i>插进输入框</span>'
            + '<span class="ssp-pbtn" data-orb-act="edit" data-id="' + esc(n.id) + '"><i class="fa-solid fa-pen"></i>编辑</span>'
            + '<span class="ssp-pbtn danger" data-orb-act="del" data-id="' + esc(n.id) + '"><i class="fa-solid fa-trash"></i></span>'
            + '</div></div>'
            + picker
            + '</div>';
    }).join('');
}

/* ============================ 影子根隔离（v1.31.65）============================
   用户要求：**「选卡」和「写卡」两个页签跟酒馆彻底解耦** —— 页面完全自己画，
   **不受酒馆美化 / 自定义 CSS 影响**，但功能依旧走原生（点卡跳转、保存…）。

   做法：
     · 这两个页签的内容渲染进一个 **Shadow Root**（浏览器保证外面的 CSS 进不来，
       连 `*{...!important}` 也不行）；
     · 样式表**不重写**：把我们自己的 style.css 文本取一次灌进影子根，
       再把主题变量在宿主上写死成一套**固定色板**（不再读 `--SmartTheme*`）；
     · 影子根里再放一个同 id 的外壳 `#ssp_orb_panel` —— 这样原来那些
       `#ssp_orb_panel .xxx` 的规则照样命中（影子里的 id 是独立作用域）；
     · 事件不用重接：click/input/change/keydown 是 composed 事件，照样冒到 document，
       只是 `ev.target` 会被重定向成宿主 → 委托里统一改用 `ev.composedPath()[0]`；
     · 读控件统一走 `sspTabRoot()`（影子在就查影子，否则查 document）。
   ========================================================================== */
var SSP_SHADOW_HOST = 'ssp_shadow_host';
/** 当前页签渲染在影子根里吗（只有选卡 / 写卡） */
function sspIsShadowTab(id) { return id === 'pick' || id === 'editor'; }
/** 取"当前页签该在哪棵树里查元素"：影子根 or document */
function sspTabRoot() {
    try {
        const h = document.getElementById(SSP_SHADOW_HOST);
        if (h && h.shadowRoot) return h.shadowRoot;
    } catch (e) { }
    return document;
}
function sspShadowRoot() {
    try {
        const h = document.getElementById(SSP_SHADOW_HOST);
        return h ? h.shadowRoot : null;
    } catch (e) { return null; }
}
/** 面板本体（影子在就取影子里那个外壳；否则取文档里那个） */
function sspPanelEl() {
    try {
        const sr = sspShadowRoot();
        if (sr) { const el = sr.getElementById('ssp_orb_panel'); if (el) return el; }
    } catch (e) { }
    return document.getElementById('ssp_orb_panel');
}
/** 按 id 取"面板里"的元素（ssp_ 开头的优先查影子，查不到再回文档） */
function sspById(id) {
    try {
        const sr = sspShadowRoot();
        if (sr) { const el = sr.getElementById(id); if (el) return el; }
    } catch (e) { }
    return document.getElementById(id);
}

/** 固定色板：**完全不跟酒馆主题/美化/自定义 CSS 走**（用户选的"跟主题彻底无关"） */
const SSP_SHADOW_VARS = [
    '--ch-ink:#ececf2', '--ch-ink-2:#b9b9c6', '--ch-ink-3:#8a8a99',
    '--ch-bg:#16161b', '--ch-2:#1d1d24', '--ch-3:#232330',
    '--ch-line:rgba(255,255,255,.14)', '--ch-accent:#79a8ff', '--ch-accent-deep:#5b8ff0',
    '--ch-acc-2:#1e2a40', '--ch-acc-3:#26374f',
    '--r-box:6px', '--r-ctl:4px',
].join(';');

/** 影子根专用的兜底/覆盖样式（在灌进来的 style.css **之后**，所以能覆盖它） */
const SSP_SHADOW_EXTRA_CSS = `
:host {
    all: initial;
    display: block;
    ${SSP_SHADOW_VARS};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: 13px; line-height: 1.5; color: #ececf2;
    -webkit-text-size-adjust: 100%;
}
:host *, :host *::before, :host *::after { box-sizing: border-box; }
/* 影子里的外壳：保留"当祖先用"（让 #ssp_orb_panel .xxx 规则命中），但把面板盒子的样式清掉。
   ⚠️ 外面那条〔*{font-family:…!important}〕打的是**宿主元素**，而 font/字距这些是**继承**下来的 ——
      只写〔:host{all:initial}〕挡不住（宿主被外层文档的规则改掉后，里面的文字照样继承）。
      所以这里用 #ssp_orb_panel（影子内的独立作用域）把继承类属性**逐个按死**。 */
:host #ssp_orb_panel {
    position: static !important; left: auto !important; top: auto !important;
    transform: none !important; width: auto !important; max-height: none !important;
    display: block !important; background: transparent !important; border: 0 !important;
    border-radius: 0 !important; box-shadow: none !important; overflow: visible !important;
    padding: 0 !important; margin: 0 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif !important;
    font-size: 13px !important; font-style: normal !important; font-weight: 400 !important;
    line-height: 1.5 !important; color: #ececf2 !important;
    letter-spacing: normal !important; word-spacing: normal !important;
    text-transform: none !important; text-shadow: none !important;
    text-align: left !important; direction: ltr !important; white-space: normal !important;
}
/* ---- 选卡页：一套**独立固定**的卡片外观（不再吃"角色卡样式"那堆旋钮/变量） ---- */
:host #ssp_orb_panel .ssp-ch-grid { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)) !important; gap: 8px !important; }
:host #ssp_orb_panel .ssp-ch-card {
    position: relative !important; display: flex !important; flex-direction: column !important; gap: 4px !important; padding: 6px !important;
    border: 1px solid rgba(255,255,255,.14) !important; border-radius: 5px !important;
    background: #1b1b22 !important; height: auto !important; min-height: 0 !important;
    cursor: pointer; touch-action: manipulation; overflow: hidden !important;
    color: #ececf2 !important; letter-spacing: normal !important;
}
:host #ssp_orb_panel .ssp-ch-card:hover { background: #22222c !important; border-color: rgba(255,255,255,.28) !important; }
:host #ssp_orb_panel .ssp-ch-card.on { border-color: #79a8ff !important; box-shadow: 0 0 0 1px rgba(121,168,255,.5) inset !important; }
/* ⚠️ 只给**选卡页的卡片**（.ssp-ch-card 里）用。写卡页的头像也用 .ssp-ch-av 这个类，
   一开始没限定 → 写卡页头像被拉成一大块、把下面的字段全顶出屏幕（用户反馈"人设卡界面出问题"）。 */
:host #ssp_orb_panel .ssp-ch-card .ssp-ch-av { width: 100% !important; aspect-ratio: 1 / 1 !important; border-radius: 6px !important; overflow: hidden !important; background: #101015 !important; position: static !important; inset: auto !important; }
:host #ssp_orb_panel .ssp-ch-card .ssp-ch-av img { width: 100% !important; height: 100% !important; object-fit: cover !important; display: block !important; border: 0 !important; border-radius: 0 !important; }
:host #ssp_orb_panel .ssp-ch-meta { min-width: 0 !important; }
:host #ssp_orb_panel .ssp-ch-meta b {
    display: block !important; font-family: inherit !important; font-size: 12.5px !important; font-weight: 700 !important;
    color: #ececf2 !important; line-height: 1.35 !important; text-shadow: none !important;
    letter-spacing: normal !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
}
:host #ssp_orb_panel .ssp-ch-tags {
    display: block !important; font-family: inherit !important; font-size: 10px !important; color: #8a8a99 !important;
    letter-spacing: normal !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
}
:host #ssp_orb_panel .ssp-ch-cardrow { border-radius: 5px !important; background: #1b1b22 !important; border: 1px solid rgba(255,255,255,.14) !important; }
:host #ssp_orb_panel .ssp-ch-cname { font-family: inherit !important; font-size: 13px !important; color: #ececf2 !important; letter-spacing: normal !important; }
/* 列表视图那一行（行里带 ssp-ch-grow / ssp-ch-cardrow，头像叫 ssp-ch-cav）
   —— 这些也要按死，不然还是吃主样式里"角色卡样式"那套（圆角 3px、color-mix 背景） */
:host #ssp_orb_panel .ssp-ch-grow {
    border-radius: 5px !important; background: #1b1b22 !important;
    border: 1px solid rgba(255,255,255,.14) !important; box-shadow: none !important;
}
:host #ssp_orb_panel .ssp-ch-grow.on { border-color: #79a8ff !important; background: #1a2233 !important; }
:host #ssp_orb_panel .ssp-ch-cav {
    width: 30px !important; height: 30px !important; flex: 0 0 30px !important;
    border-radius: 6px !important; overflow: hidden !important;
    background: #101015 !important; border: 1px solid rgba(255,255,255,.16) !important;
    display: inline-flex !important; align-items: center !important; justify-content: center !important;
}
:host #ssp_orb_panel .ssp-ch-cav img { width: 100% !important; height: 100% !important; object-fit: cover !important; border: 0 !important; border-radius: 0 !important; display: block !important; }
:host #ssp_orb_panel .ssp-ch-cname b { font-family: inherit !important; font-size: 13px !important; font-weight: 700 !important;
    color: #ececf2 !important; letter-spacing: normal !important; text-shadow: none !important; }
/* 写卡页：输入框/按钮固定观感（不吃主题的 input/button 规则） */
:host #ssp_orb_panel .ssp-ch-inp, :host #ssp_orb_panel .ssp-inp {
    background: #101015 !important; color: #ececf2 !important;
    border: 1px solid rgba(255,255,255,.18) !important; border-radius: 3px !important;
    font-family: inherit !important; font-size: 12.5px !important; line-height: 1.5 !important;
    letter-spacing: normal !important; text-shadow: none !important;
}
:host #ssp_orb_panel .ssp-pbtn {
    border: 1px solid rgba(255,255,255,.2) !important; border-radius: 3px !important;
    background: rgba(255,255,255,.06) !important; color: #ececf2 !important;
    font-family: inherit !important; font-size: 11.5px !important; letter-spacing: normal !important;
    text-shadow: none !important; text-transform: none !important;
}
:host #ssp_orb_panel .ssp-pbtn:hover { background: rgba(255,255,255,.14) !important; }
:host #ssp_orb_panel .ssp-pbtn.primary { border-color: #79a8ff !important; background: #1e2a40 !important; }
`;

/** 图标字体（FontAwesome）的样式表地址 —— 影子根**继承不到**文档里的样式，
    不把它们 link 进去，`<i class="fa-solid">` 就只剩一个 0 宽的空白（用户反馈"图标都没了"）。 */
function sspShadowIconLinks() {
    try {
        const out = [];
        document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
            const h = l.getAttribute('href') || '';
            if (/fontawesome|font-awesome|solid\.min\.css|brands\.min\.css|regular\.min\.css/i.test(h)) out.push(h);
        });
        return out;
    } catch (e) { return []; }
}

/** v1.31.71 给这两个页签做的一套**皮肤**（只在影子根里用；加在最后，所以能盖住前面的规则）。
    目标是"层次清晰、看得清"：页面底 → 区块卡片 → 行 → 控件，四级明暗；标签小而稳、占位符不再糊成一片。 */
const SSP_SHADOW_SKIN = `
:host #ssp_orb_panel {
    background: #1b1b21 !important;
    color: #e8e8ef !important;
    padding: 12px 13px 16px !important;
}
/* ---- 区块卡片 ---- */
:host #ssp_orb_panel .ssp-ch-vgroup {
    background: #22222a !important; border: 1px solid rgba(255,255,255,.09) !important;
    border-radius: 5px !important; margin-bottom: 10px !important; overflow: hidden !important;
}
:host #ssp_orb_panel .ssp-ch-vghead {
    background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.015)) !important;
    border-bottom: 1px solid rgba(255,255,255,.08) !important;
    padding: 8px 11px !important; font-size: 12px !important; font-weight: 700 !important;
    color: #cfcfdb !important; letter-spacing: .2px !important;
}
/* ---- 行：左标签 + 右控件 ---- */
:host #ssp_orb_panel .ssp-ch-vrow {
    padding: 10px 11px !important; border-bottom: 1px solid rgba(255,255,255,.06) !important;
    background: transparent !important; gap: 10px !important; align-items: start !important;
}
:host #ssp_orb_panel .ssp-ch-vrow:last-child { border-bottom: 0 !important; }
:host #ssp_orb_panel .ssp-ch-vlab, :host #ssp_orb_panel .ssp-ch-vrow > label,
:host #ssp_orb_panel .ssp-ch-clabel {
    color: #a9a9ba !important; font-size: 11.5px !important; letter-spacing: .2px !important;
    line-height: 1.6 !important; text-shadow: none !important;
}
/* ---- 输入框 / 文本域：深一档底 + 明显的焦点圈 ---- */
:host #ssp_orb_panel .ssp-ch-inp, :host #ssp_orb_panel .ssp-inp {
    background: #15151a !important; color: #ececf2 !important;
    border: 1px solid rgba(255,255,255,.12) !important; border-radius: 3px !important;
    padding: 7px 9px !important; font-size: 12.5px !important; line-height: 1.6 !important;
    transition: border-color .15s, box-shadow .15s !important;
}
:host #ssp_orb_panel .ssp-ch-inp::placeholder, :host #ssp_orb_panel .ssp-inp::placeholder {
    color: #6c6c7c !important; opacity: 1 !important;
}
:host #ssp_orb_panel .ssp-ch-inp:focus, :host #ssp_orb_panel .ssp-inp:focus {
    border-color: #6ea8ff !important; box-shadow: 0 0 0 2px rgba(110,168,255,.18) !important; outline: none !important;
}
:host #ssp_orb_panel textarea.ssp-ch-inp { min-height: 88px !important; resize: vertical !important; }
/* ---- 分页条 ---- */
:host #ssp_orb_panel .ssp-ch-tabs {
    background: #1f1f26 !important; border: 1px solid rgba(255,255,255,.09) !important;
    border-radius: 3px !important; padding: 3px !important; gap: 3px !important; display: flex !important;
}
:host #ssp_orb_panel .ssp-ch-tab {
    border-radius: 3px !important; padding: 5px 11px !important; font-size: 12px !important;
    color: #a9a9ba !important; cursor: pointer !important; transition: background .15s, color .15s !important;
}
:host #ssp_orb_panel .ssp-ch-tab:hover { background: rgba(255,255,255,.07) !important; color: #e8e8ef !important; }
:host #ssp_orb_panel .ssp-ch-tab.on { background: #2c2c36 !important; color: #fff !important; font-weight: 700 !important; }
/* ---- 保存条 ---- */
:host #ssp_orb_panel #ssp_vault_savebar {
    background: #1f1f26 !important; border: 1px solid rgba(255,255,255,.1) !important;
    border-radius: 4px !important; padding: 6px 8px !important;
}
/* ---- 按钮 ---- */
:host #ssp_orb_panel .ssp-pbtn {
    border: 1px solid rgba(255,255,255,.14) !important; border-radius: 3px !important;
    background: #2a2a33 !important; color: #e8e8ef !important;
    padding: 5px 11px !important; font-size: 12px !important; line-height: 1.5 !important;
    transition: background .15s, border-color .15s, transform .08s !important;
}
:host #ssp_orb_panel .ssp-pbtn:hover { background: #33333d !important; border-color: rgba(255,255,255,.26) !important; }
:host #ssp_orb_panel .ssp-pbtn:active { transform: translateY(1px) !important; }
:host #ssp_orb_panel .ssp-pbtn.primary {
    background: #2b3f66 !important; border-color: #4d7fd6 !important; color: #eaf1ff !important; font-weight: 700 !important;
}
:host #ssp_orb_panel .ssp-pbtn.primary:hover { background: #33507f !important; }
:host #ssp_orb_panel .ssp-pbtn.danger { background: #4a2530 !important; border-color: #8c4053 !important; color: #ffdfe6 !important; }
/* ---- 选卡页：列表行 / 头像墙 ---- */
:host #ssp_orb_panel .ssp-ch-grow {
    background: #22222a !important; border: 1px solid rgba(255,255,255,.08) !important;
    border-radius: 4px !important; margin-bottom: 5px !important; padding: 6px 9px !important;
    transition: background .15s, border-color .15s !important;
}
:host #ssp_orb_panel .ssp-ch-grow:hover { background: #282832 !important; border-color: rgba(110,168,255,.35) !important; }
:host #ssp_orb_panel .ssp-ch-grow.on { background: #242f45 !important; border-color: #6ea8ff !important; }
:host #ssp_orb_panel .ssp-ch-grow .ssp-ch-cardrow { background: transparent !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; }
:host #ssp_orb_panel .ssp-ch-cav {
    width: 34px !important; height: 34px !important; flex: 0 0 34px !important;
    border-radius: 4px !important; border: 1px solid rgba(255,255,255,.14) !important; background: #15151a !important;
}
:host #ssp_orb_panel .ssp-ch-cname b, :host #ssp_orb_panel .ssp-ch-meta b {
    font-size: 13px !important; font-weight: 700 !important; color: #e8e8ef !important;
}
:host #ssp_orb_panel .ssp-ch-card {
    background: #22222a !important; border: 1px solid rgba(255,255,255,.08) !important; border-radius: 5px !important;
    transition: background .15s, border-color .15s, transform .08s !important;
}
:host #ssp_orb_panel .ssp-ch-card:hover { background: #2a2a34 !important; border-color: rgba(110,168,255,.45) !important; transform: translateY(-1px) !important; }
:host #ssp_orb_panel .ssp-ch-card.on { border-color: #6ea8ff !important; box-shadow: 0 0 0 1px rgba(110,168,255,.45) inset !important; }
/* 搜索框 / 模式条那几行 */
:host #ssp_orb_panel .ssp-orb-pfilter { gap: 6px !important; margin-bottom: 8px !important; }
:host #ssp_orb_panel .ssp-orb-pcount { color: #8f8fa2 !important; font-size: 11px !important; }
`;

/** v1.31.71「文档风」皮肤：少盒子、弱边框、排版为主（用户选的这版）。
    只在影子根里生效；加在最后，能盖住前面的规则。
    · 区块不再是一张张卡片，而是一节一节的长文（只用细横线分隔）
    · 字段标签变成控件上方的小号 meta（大写、字距略开）
    · 输入框只有一条底线，聚焦才显蓝线 + 极淡底色；长文本才给一个"引用块"式的框
    · 页签是文字 + 下划线高亮；按钮基本是纯文字，只有主操作带一点蓝底
    · 选卡页做成"目录"：细横线分隔、当前项左侧一条蓝竖线 */
const SSP_SHADOW_DOC = `
:host #ssp_orb_panel {
    background: #191920 !important; color: #ececf2 !important;
    padding: 18px 22px 26px !important;
    font-size: 13.5px !important; line-height: 1.78 !important;
    -webkit-font-smoothing: antialiased !important;
}
:host #ssp_orb_panel * { box-sizing: border-box !important; }
/* 区块 = 一节长文 */
:host #ssp_orb_panel .ssp-ch-vgroup {
    background: transparent !important; border: 0 !important; border-radius: 0 !important;
    margin: 0 !important; padding: 18px 0 0 !important; overflow: visible !important;
}
:host #ssp_orb_panel .ssp-ch-vgroup + .ssp-ch-vgroup { border-top: 1px solid rgba(255,255,255,.06) !important; }
:host #ssp_orb_panel .ssp-ch-vghead {
    background: none !important; border: 0 !important; padding: 0 0 10px !important;
    font-size: 14.5px !important; font-weight: 700 !important; color: #fff !important; letter-spacing: .2px !important;
}
/* 字段：标签在上、控件占满整行 */
:host #ssp_orb_panel .ssp-ch-vrow {
    display: block !important; padding: 0 0 15px !important; border: 0 !important;
    background: transparent !important; margin: 0 !important;
}
:host #ssp_orb_panel .ssp-ch-vlab, :host #ssp_orb_panel .ssp-ch-clabel,
:host #ssp_orb_panel .ssp-ch-vrow > label {
    display: block !important; margin: 0 0 5px !important;
    font-size: 11px !important; letter-spacing: .6px !important; text-transform: uppercase !important;
    color: #83839a !important; line-height: 1.6 !important; text-shadow: none !important;
}
/* 单行输入：只有一条底线 */
:host #ssp_orb_panel .ssp-ch-inp:not(textarea), :host #ssp_orb_panel .ssp-inp:not(textarea) {
    background: transparent !important; color: #ececf2 !important;
    border: 0 !important; border-bottom: 1px solid rgba(255,255,255,.12) !important; border-radius: 0 !important;
    padding: 4px 1px 6px !important; font-size: 13.5px !important; line-height: 1.7 !important;
    transition: border-color .15s, background .15s !important;
}
:host #ssp_orb_panel .ssp-ch-inp:not(textarea):hover, :host #ssp_orb_panel .ssp-inp:not(textarea):hover {
    border-bottom-color: rgba(255,255,255,.24) !important;
}
:host #ssp_orb_panel .ssp-ch-inp:not(textarea):focus, :host #ssp_orb_panel .ssp-inp:not(textarea):focus {
    outline: none !important; border-bottom-color: #6ea8ff !important; background: rgba(110,168,255,.05) !important;
    box-shadow: none !important;
}
/* 长文本：唯一保留框的地方（引用块感） */
:host #ssp_orb_panel textarea.ssp-ch-inp, :host #ssp_orb_panel textarea.ssp-inp {
    background: #15151c !important; color: #ececf2 !important;
    border: 1px solid rgba(255,255,255,.08) !important; border-radius: 3px !important;
    padding: 10px 11px !important; min-height: 96px !important; resize: vertical !important;
    font-size: 13px !important; line-height: 1.72 !important; box-shadow: none !important;
}
:host #ssp_orb_panel textarea.ssp-ch-inp:focus, :host #ssp_orb_panel textarea.ssp-inp:focus {
    border-color: rgba(110,168,255,.6) !important; background: #16161e !important; outline: none !important;
}
:host #ssp_orb_panel .ssp-ch-inp::placeholder, :host #ssp_orb_panel .ssp-inp::placeholder { color: #62627a !important; opacity: 1 !important; }
/* 页签：文字 + 下划线 */
:host #ssp_orb_panel .ssp-ch-tabs {
    background: transparent !important; border: 0 !important; border-bottom: 1px solid rgba(255,255,255,.07) !important;
    border-radius: 0 !important; padding: 0 !important; gap: 18px !important; display: flex !important; margin: 14px 0 4px !important;
}
:host #ssp_orb_panel .ssp-ch-tab {
    background: none !important; border: 0 !important; border-bottom: 2px solid transparent !important;
    border-radius: 0 !important; padding: 6px 0 8px !important; margin-bottom: -1px !important;
    font-size: 12.5px !important; color: #8b8b9c !important; cursor: pointer !important;
}
:host #ssp_orb_panel .ssp-ch-tab:hover { color: #d8d8e4 !important; background: none !important; }
:host #ssp_orb_panel .ssp-ch-tab.on {
    color: #fff !important; border-bottom-color: #6ea8ff !important; font-weight: 600 !important; background: none !important;
}
/* 保存条：一条细线 + 透明底 */
:host #ssp_orb_panel #ssp_vault_savebar {
    background: transparent !important; border: 0 !important; border-bottom: 1px solid rgba(255,255,255,.07) !important;
    border-radius: 0 !important; padding: 8px 0 !important; margin-bottom: 4px !important;
}
/* 按钮：以文字为主 */
:host #ssp_orb_panel .ssp-pbtn {
    background: transparent !important; border: 1px solid transparent !important; border-radius: 3px !important;
    padding: 5px 10px !important; font-size: 12.5px !important; line-height: 1.5 !important; color: #d6d6e2 !important;
    transition: background .15s, color .15s !important;
}
:host #ssp_orb_panel .ssp-pbtn:hover { background: rgba(255,255,255,.07) !important; color: #fff !important; }
:host #ssp_orb_panel .ssp-pbtn.primary {
    background: rgba(110,168,255,.13) !important; border-color: rgba(110,168,255,.35) !important;
    color: #cfe0ff !important; font-weight: 600 !important;
}
:host #ssp_orb_panel .ssp-pbtn.primary:hover { background: rgba(110,168,255,.2) !important; }
:host #ssp_orb_panel .ssp-pbtn.danger {
    background: rgba(220,90,110,.12) !important; border-color: rgba(220,90,110,.3) !important; color: #ffc9d2 !important;
}
/* 选卡页：像目录 */
:host #ssp_orb_panel .ssp-ch-grow {
    background: transparent !important; border: 0 !important; border-bottom: 1px solid rgba(255,255,255,.05) !important;
    border-radius: 0 !important; margin: 0 !important; padding: 9px 2px !important;
}
:host #ssp_orb_panel .ssp-ch-grow:hover { background: rgba(255,255,255,.03) !important; }
:host #ssp_orb_panel .ssp-ch-grow.on {
    background: rgba(110,168,255,.08) !important; border-bottom-color: rgba(255,255,255,.05) !important;
    box-shadow: inset 2px 0 0 #6ea8ff !important;
}
:host #ssp_orb_panel .ssp-ch-grow .ssp-ch-cardrow { background: transparent !important; border: 0 !important; padding: 0 !important; }
:host #ssp_orb_panel .ssp-ch-cav {
    width: 30px !important; height: 30px !important; flex: 0 0 30px !important;
    border-radius: 3px !important; border: 1px solid rgba(255,255,255,.1) !important; background: #22222b !important;
}
:host #ssp_orb_panel .ssp-ch-cname b, :host #ssp_orb_panel .ssp-ch-meta b {
    font-size: 13.5px !important; font-weight: 600 !important; color: #ececf2 !important; letter-spacing: .2px !important;
}
:host #ssp_orb_panel .ssp-ch-gtag {
    background: none !important; color: #8b8b9c !important; font-size: 10px !important; letter-spacing: .5px !important;
}
:host #ssp_orb_panel .ssp-ch-gops { opacity: .5 !important; }
:host #ssp_orb_panel .ssp-ch-grow:hover .ssp-ch-gops { opacity: 1 !important; }
/* 头像墙（切到格子视图时）：轻卡片、无重边框 */
:host #ssp_orb_panel .ssp-ch-card {
    background: #1e1e25 !important; border: 1px solid rgba(255,255,255,.06) !important; border-radius: 4px !important;
    padding: 5px !important; transition: background .15s, border-color .15s !important;
}
:host #ssp_orb_panel .ssp-ch-card:hover { background: #24242c !important; border-color: rgba(110,168,255,.4) !important; }
:host #ssp_orb_panel .ssp-ch-card.on { border-color: #6ea8ff !important; box-shadow: 0 0 0 1px rgba(110,168,255,.35) inset !important; }
/* 标签旁边那个字数（比如「角色描述 10728」）别糊在一起 */
:host #ssp_orb_panel .ssp-ch-cnt {
    margin-left: 7px !important; font-size: 10px !important; font-style: normal !important;
    opacity: .55 !important; letter-spacing: 0 !important; text-transform: none !important;
}
/* 搜索 / 计数那几行 */
:host #ssp_orb_panel .ssp-orb-pfilter { gap: 6px !important; margin: 14px 0 8px !important; }
:host #ssp_orb_panel .ssp-orb-pcount { color: #7a7a90 !important; font-size: 11px !important; margin: 6px 0 !important; }
`;

/** 把我们的 style.css 文本取一次、缓存起来（地址从酒馆给我们注入的 <link> 上找，不写死路径） */
var sspShadowCssCache = '';
function sspStyleHref() {
    try {
        const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        const hit = links.find(l => /ShuShuTweaks[^?#]*\/style\.css/i.test(l.getAttribute('href') || '')
            || /style\.css/i.test(l.getAttribute('href') || '') && /ShuShuTweaks/i.test(l.href || ''));
        return hit ? hit.href : '';
    } catch (e) { return ''; }
}
async function sspShadowCss() {
    if (sspShadowCssCache) return sspShadowCssCache;
    try {
        const href = sspStyleHref();
        if (!href) return '';
        const r = await fetch(href, { cache: 'force-cache' });
        if (!r.ok) return '';
        sspShadowCssCache = await r.text();
        return sspShadowCssCache;
    } catch (e) { return ''; }
}

/** 渲染当前页签到影子根（幂等）。
    ⚠️ **先同步填一版**（用已缓存的样式，可能还没取到），再异步补齐样式 ——
       否则"等 CSS 取回来"那几十毫秒里宿主是空的，量出来 0×0、也查不到卡片（实测踩到）。 */
async function sspShadowRender() {
    try {
        const host = document.getElementById(SSP_SHADOW_HOST);
        if (!host) return false;
        const cur = orbModule(orbTab) || ORB_MODULES[0];
        if (!sspIsShadowTab(cur.id)) return false;
        if (!host.shadowRoot) {
            try { host.attachShadow({ mode: 'open' }); } catch (e) { return false; }
        }
        /* 测试/脚本合成的 `new Event('input')` 默认**不 composed**，跨不出影子边界
           （真人敲键盘是 composed，生产环境没这问题）。测试环境里在影子根上收到这种事件时，
           就地补发一份 composed 的同款事件（target 还是原来那个元素），让 document 上的委托照常收到。 */
        try {
            if (host.shadowRoot && !host.shadowRoot.__sspComposeFix) {
                host.shadowRoot.__sspComposeFix = true;
                ['input', 'change'].forEach(type => {
                    host.shadowRoot.addEventListener(type, (ev) => {
                        try {
                            if (!globalThis.__SSP_TEST__) return;
                            if (ev.composed) return;
                            const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
                            if (!t || !t.dispatchEvent) return;
                            const clone = new (ev.constructor || Event)(ev.type, { bubbles: true, composed: true, cancelable: ev.cancelable });
                            t.dispatchEvent(clone);
                        } catch (e) { }
                    }, false);
                });
            }
        } catch (e) { }
        const paint = (css) => {
            const root = host.shadowRoot;
            const html = cur.render();
            const iconLinks = sspShadowIconLinks()
                .map(h => '<link rel="stylesheet" href="' + esc(h) + '">').join('');
            root.innerHTML = iconLinks
                + '<style>' + (css || '') + '</style>'
                + '<style>' + SSP_SHADOW_EXTRA_CSS + '</style>'
                + '<style>' + SSP_SHADOW_DOC + '</style>'
                /* ⚠️ 外壳必须同时带 **class="ssp-orb-panel"**：主样式里大量规则是
                   `.ssp-orb-panel .ssp-pbtn{…}` 这种 **class** 选择器（不是 #id），
                   只给 id 的话它们全部不命中 → 按钮/文字的 padding、字号、间距全丢，
                   表现就是"图标和字都满出去了"（用户反馈）。 */
                + '<div id="ssp_orb_panel" class="ssp-orb-panel">' + html + '</div>';
        };
        /* ① 同步先画（有缓存就用缓存，没有就先空样式顶上） */
        paint(sspShadowCssCache);
        if (cur.id === 'editor') {
            try { chPanesLoad(chPanesLoadedTab); } catch (e) { }
            try { chRefreshAvatars(); } catch (e) { }
            try { chSyncFav(); } catch (e) { }
        }
        /* ② 样式还没到 → 取到后补一遍 */
        if (!sspShadowCssCache) {
            const css = await sspShadowCss();
            if (css && orbOpenNow && sspIsShadowTab(orbTab)) paint(css);
        }
        return true;
    } catch (e) { return false; }
}

/* 只在测试环境用的兼容层：老测试都是 `panel().querySelector('[data-chk=…]')` 这种写法，
   这两页进影子根以后就查不到了。这里只给 #ssp_orb_panel 这一个元素打补丁：
   先查自己，查不到再去影子根里查（生产环境完全不生效，__SSP_TEST__ 为假时直接跳过）。 */
function sspInstallTestQueryShim() {
    try {
        if (!globalThis.__SSP_TEST__ || sspInstallTestQueryShim.done) return false;
        sspInstallTestQueryShim.done = true;
        const patch = (proto, isDoc) => {
            const q1 = proto.querySelector;
            const qa = proto.querySelectorAll;
            /* ⚠️ **只对"我们自己的选择器"兜底**。全局给 document 打补丁会把酒馆自己的查询也改掉；
               而判断"是不是我们自己的"不能只认 .ssp- / data-ssp —— 大量 mark 是 data-orb-* / data-ch*
               （比如 [data-orb-cftab]、[data-chk]），一开始漏了它们，测试就查不到 → 空数组。 */
            const mine = (sel) => /#ssp|\.ssp|data-ssp|data-orb|data-ch/.test(String(sel || ''));
            proto.querySelector = function (sel) {
                const r = q1.call(this, sel);
                if (r) return r;
                if (!mine(sel)) return r;
                try {
                    const sr = sspShadowRoot();
                    /* ⚠️ 必须用影子根**自己的**方法：拿 Document.prototype 的方法去调 ShadowRoot
                       是非法调用（会抛，然后被 catch 吞掉 → 永远查不到，实测踩到）。 */
                    if (sr && (isDoc || this.id === 'ssp_orb_panel')) return sr.querySelector(sel);
                } catch (e) { }
                return r;
            };
            proto.querySelectorAll = function (sel) {
                const local = qa.call(this, sel);
                if (!mine(sel)) return local;
                try {
                    const sr = sspShadowRoot();
                    if (sr && (isDoc || this.id === 'ssp_orb_panel')) {
                        const inner = sr.querySelectorAll(sel);
                        if (inner.length) return Array.from(local).concat(Array.from(inner));
                    }
                } catch (e) { }
                return local;
            };
        };
        patch(Element.prototype, false);
        patch(Document.prototype, true);
        /* 还有一个漏网的：`sspById('ssp_vault_savebar')` 这类**按 id** 直接取的，
           演进影子根以后 document 上就没有了（老测试里到处都是）。只有 ssp_ 开头的才回退。 */
        try {
            const gid = Document.prototype.getElementById;
            Document.prototype.getElementById = function (id) {
                const r = gid.call(this, id);
                if (r) return r;
                if (!/^ssp_/.test(String(id || ''))) return r;
                try {
                    const sr = sspShadowRoot();
                    if (sr) return sr.getElementById(id);
                } catch (e) { }
                return r;
            };
        } catch (e) { }
        return true;
    } catch (e) { return false; }
}

/* ============================ 页签收纳（v1.31.63）============================
   用户抱怨："手机上的标签已经快来到三行了" —— 13 个页签一换行就把聊天可视高度吃掉了。

   规则（用户选的）：**他自己指定"一定收起来"的那几个**；其余一律显示；
   收起来的进末尾那颗「…」，点开弹出来（图标+名字），点一下就切过去。
   - 桌面也收（用户选的）：不按屏幕宽窄区别对待
   - 自动兜底：就算他把什么都设成"显示"，只要当前宽度放不下，也会把**末尾那几个**挤进「…」，
     保证页签栏永远是**一行**（挤进去的不写进设置，屏幕变宽就自己回来）
   - 当前页签被收进去时，「…」那颗高亮（不然找不到自己在哪一页）
   ========================================================================== */
var orbTabMenu = false;        // 「…」弹层开着吗
var orbTabMenuEdit = false;    // 弹层里的"整理"模式
var orbTabSqueeze = new Set(); // 因为放不下被临时挤进「…」的（只是内存，不落盘）

/** 用户指定"一定收起来"的页签 id（只认现存模块，顺序按 ORB_MODULES） */
function orbTabHidden() {
    const s = getSettings();
    if (!Array.isArray(s.orbTabHidden)) s.orbTabHidden = [];
    const ok = s.orbTabHidden.filter(id => ORB_MODULES.some(m => m.id === id));
    if (ok.length !== s.orbTabHidden.length) s.orbTabHidden = ok;
    return ok;
}
function orbTabIsHidden(id) { return orbTabHidden().indexOf(id) >= 0; }
/** 收 / 放一个页签（返回 true = 现在收起来了） */
function orbTabHideSet(id, on) {
    const s = getSettings();
    const list = orbTabHidden().slice();
    const i = list.indexOf(id);
    if (on && i < 0) list.push(id);
    if (!on && i >= 0) list.splice(i, 1);
    s.orbTabHidden = list;
    if (!on) orbTabSqueeze.delete(id);        // 手动放出来就别再挤回去
    save();
    return list.indexOf(id) >= 0;
}
/** 现在真正进「…」的是哪些（指定收起来的 ∪ 因为放不下被挤的），顺序仍按 ORB_MODULES */
function orbTabOverflowIds() {
    const hid = orbTabHidden();
    return ORB_MODULES.filter(m => hid.indexOf(m.id) >= 0 || orbTabSqueeze.has(m.id)).map(m => m.id);
}
function orbTabChipHTML(m, cur, extraCls) {
    return '<span class="ssp-orb-tab' + (m.id === cur.id ? ' on' : ' off') + (extraCls || '')
        + '" data-orb-tab="' + m.id + '" title="' + esc(m.name) + '">'
        + '<i class="fa-solid ' + m.icon + '"></i>' + esc(m.name) + '</span>';
}
/** 页签栏：显示"没被收起来的" + 末尾那颗「…」 */
function orbTabsHTML(cur) {
    const over = orbTabOverflowIds();
    const shown = ORB_MODULES.filter(m => over.indexOf(m.id) < 0);
    const curHidden = over.indexOf(cur.id) >= 0;
    const more = '<span class="ssp-orb-tabmore' + (curHidden ? ' on' : '') + '" data-orb-tabmore="1"'
        + ' title="' + (over.length ? ('还有 ' + over.length + ' 个页签收在这里 · 点开；也可以在这里整理') : '整理页签（把不常用的收进来）') + '">'
        + (curHidden ? ('<i class="fa-solid ' + cur.icon + '"></i>') : '')
        + '<i class="fa-solid fa-ellipsis"></i>'
        + (over.length ? '<span class="ssp-tabmore-n">' + over.length + '</span>' : '')
        + '</span>';
    return shown.map(m => orbTabChipHTML(m, cur)).join('')
        + more
        + '<span class="ssp-tab-now">' + esc(cur.name) + '</span>';
}
/** 「…」弹层：上半是收起来的页签（点一下切过去），下半是"整理"开关 */
function orbTabMenuHTML(cur) {
    if (!orbTabMenu) return '';
    const over = orbTabOverflowIds();
    const overMods = ORB_MODULES.filter(m => over.indexOf(m.id) >= 0);
    const listRows = overMods.length
        ? overMods.map(m => '<span class="ssp-orb-tab' + (m.id === cur.id ? ' on act' : ' off')
            + '" data-orb-tabopen="' + m.id + '" title="切到「' + esc(m.name) + '」">'
            + '<i class="fa-solid ' + m.icon + '"></i>' + esc(m.name) + '</span>').join('')
        : '<span class="ssp-orb-tabmenu-h">没有收起来的页签 —— 下面点「整理」可以把不常用的收进来。</span>';
    const editRows = orbTabMenuEdit
        ? ORB_MODULES.map(m => {
            /* ⚠️ 三种状态要分清（第一版只判了"显式收起的"，于是被宽度挤进「…」的也显示"显示中"，
               用户看着就是"明明收起来了却说显示中"）：
                 显式收起 → 已收进… ｜ 因为放不下被挤的 → 放不下 ｜ 其余 → 显示中 */
            const hid = orbTabIsHidden(m.id);
            const squeezed = !hid && orbTabSqueeze.has(m.id);
            const label = hid ? '已收进…' : (squeezed ? '放不下' : '显示中');
            return '<div class="ssp-orb-tabedit-row' + ((hid || squeezed) ? ' hid' : '') + '" data-orb-tabhide="' + m.id + '"'
                + ' title="点一下＝' + (hid ? '放回页签栏' : '收进「…」') + '">'
                + '<i class="fa-solid ' + m.icon + '"></i>'
                + '<span class="ssp-orb-tabedit-n">' + esc(m.name) + '</span>'
                + '<span class="ssp-orb-tabedit-s">' + label + '</span>'
                + '</div>';
        }).join('')
        : '';
    return '<div class="ssp-orb-tabmenu">'
        + '<div class="ssp-orb-tabmenu-h"><b>收在这里的页签（' + overMods.length + '）</b>'
        + '<span style="margin-left:auto"></span>'
        + '<span class="ssp-pbtn" data-orb-tabmenuedit="1">' + (orbTabMenuEdit ? '完成' : '整理') + '</span>'
        + '<span class="ssp-pbtn" data-orb-tabmenuclose="1">关闭</span></div>'
        + '<div class="ssp-orb-tabmenu-row">' + listRows + '</div>'
        + (orbTabMenuEdit
            ? '<div class="ssp-orb-tabmenu-h" style="margin-top:4px"><b>整理：点一行＝收起来 / 放回去</b></div>'
                + '<div class="ssp-orb-tabmenu-row" style="flex-direction:column;gap:4px">' + editRows + '</div>'
                + '<span class="ssp-orb-tabmenu-h">页签栏永远只有一行：显示不下的会自动挤进「…」（不写进设置，屏幕变宽自己回来）。</span>'
            : '')
        + '</div>';
}

/** 放不下就把**末尾**的挤进「…」（只在内存里），保证页签栏永远一行。
    ⚠️ 必须在 DOM 插进去之后量，所以由 renderOrbPanel 和窗口 resize 调用。 */
function orbTabsFit() {
    try {
        const bar = sspTabRoot().querySelector('#ssp_orb_panel .ssp-orb-tabs');
        if (!bar) return false;
        const cur = orbModule(orbTab) || ORB_MODULES[0];
        let guard = 0;
        while (bar.scrollWidth > bar.clientWidth + 1 && guard++ < 40) {
            const shown = ORB_MODULES.filter(m => {
                const id = m.id;
                const over = orbTabHidden().indexOf(id) >= 0 || orbTabSqueeze.has(id);
                return !over;
            });
            /* 只挤"最后一个还在栏里的"；要是只剩当前页签了就别挤它（否则「…」里全是空的） */
            const last = shown.length ? shown[shown.length - 1] : null;
            if (!last) break;
            if (shown.length <= 1) break;
            orbTabSqueeze.add(last.id);
            bar.innerHTML = orbTabsHTML(cur);
        }
        return true;
    } catch (e) { return false; }
}

function orbPanelHTML() {
    const e = orbEditing;
    const cur = orbModule(orbTab) || ORB_MODULES[0];
    return '<div class="ssp-orb-head"><span class="ssp-orb-logo"></span>'
        + '<div class="ssp-orb-title"><b>鼠鼠口袋</b><small>' + esc(cur.name) + ' · ' + ORB_MODULES.length + ' 个模块</small></div>'
        + '<span class="ssp-pbtn" data-orb-dbgopen="1" title="调试（脚本测试 / 一键诊断 / 抓元素）→ 见最后那个「调试」页签"><i class="fa-solid fa-code"></i></span>'
        + '<span class="ssp-pbtn" data-orb-retract="1" title="收回悬浮球（之后从酒馆「扩展」列表里的鼠鼠面板再打开）"><i class="fa-solid fa-eye-slash"></i></span>'
        + '<span class="ssp-pbtn" data-orb-close="1"><i class="fa-solid fa-xmark"></i></span></div>'
        + '<div class="ssp-orb-tabwrap"><div class="ssp-orb-tabs">' + orbTabsHTML(cur) + '</div>'
        + orbTabMenuHTML(cur) + '</div>'
        + '<div class="ssp-orb-body">'
        + (e ? '<div class="ssp-orb-edit">'
            + '<input class="ssp-inp" type="text" data-orb-f="title" placeholder="标题（比如：番外·雨夜）" value="' + esc(e.title || '') + '">'
            + '<textarea class="ssp-inp ssp-orb-ta" data-orb-f="text" rows="9" placeholder="正文…">' + esc(e.text || '') + '</textarea>'
            + '<div class="ssp-orb-edit-a">'
            + '<span class="ssp-pbtn primary" data-orb-act="save" data-id="' + esc(e.id || '') + '"><i class="fa-solid fa-check"></i>保存</span>'
            + '<span class="ssp-pbtn" data-orb-act="cancel">取消</span>'
            + (e.id ? '<span class="ssp-pbtn danger" data-orb-act="del" data-id="' + esc(e.id) + '"><i class="fa-solid fa-trash"></i>删掉这条</span>' : '')
            + '</div></div>'
            /* v1.31.65：选卡 / 写卡两页渲染进 Shadow Root（内容由 sspShadowRender 填） */
            : (sspIsShadowTab(cur.id) ? '<div id="' + SSP_SHADOW_HOST + '"></div>' : cur.render()))
        + '</div>';
}

/** 只换面板**内部**（绝不重画容器，否则球会被一起换掉）
    ⚠️ 会还原滚动位置：整块 innerHTML 一换，滚动就回顶了 ——
    开关一条世界书 / 条目、切个绑定，列表一长每次都被弹回顶部，很烦（用户反馈）。
    滚动容器是 .ssp-orb-body；这里记它、重画后写回。 */
function renderOrbPanel() {
    const panel = document.getElementById('ssp_orb_panel');
    if (!panel) return false;
    const oldBody = panel.querySelector('.ssp-orb-body');
    const keepTop = oldBody ? oldBody.scrollTop : 0;
    /* ⚠️ 重画 = 把整个 .ssp-orb-body 换掉。写卡页签里现在**没有借来的 DOM 了**
       （原生框子一直待在酒馆放它们的位置，只是被 pin 样式藏住），所以
       重画只会换掉我们自己的骨架 → 记一下"上一帧有没有骨架"，重画后重挂 + 重读。 */
    try { chUnmountFrameSoft(); } catch (e) { }
    panel.innerHTML = orbPanelHTML();
    /* v1.31.63：页签栏必须**一行** —— 插进 DOM 后量一次，放不下的挤进「…」 */
    try { orbTabsFit(); } catch (e) { }
    /* v1.31.65：选卡 / 写卡两页渲染进影子根（异步取样式，取到会再补一次） */
    try { if (sspIsShadowTab(orbTab)) sspShadowRender(); } catch (e) { }
    const newBody = panel.querySelector('.ssp-orb-body');
    if (newBody) {
        const max = Math.max(0, (newBody.scrollHeight || 0) - (newBody.clientHeight || 0));
        newBody.scrollTop = Math.min(keepTop, max);
    }
    /* 写卡页签：重画后收拾骨架（第一次铺分页内容 / 重挂被换掉的原生框子 / 读一次值） */
    if (orbTab === 'editor') {
        try { chMountFrame(); } catch (e) { }
        try { chSavebarInit(); } catch (e) { }
        try { chPanesLoad(chPanesLoadedTab); } catch (e) { }
        try { chBindNativeOnce(); } catch (e) { }
        try { chBindOverlayWatch(); } catch (e) { }
        if (!chPulledOnce) { chPulledOnce = true; try { chPull(true); } catch (e) { } }
    } else {
        chPanesLoadedTab = false;
        chPulledOnce = false;
    }
    refreshOrbBadge();
    /* 「调试」页签：重画后把脚本内容 / 输出补回去（HTML 里只放了输出，文本框是空的） */
    if (orbTab === 'debug') { try { orbDbgPaint(); } catch (e) { } }
    /* v1.31.77：每次重画顺手把面板配色按当前档位过一遍（面板刚建好，量出来的才是真值） */
    try { sspSkinApply(); } catch (e) { }
    return true;
}

/** 把元素滚进视野（展开编辑表单时用，别让输入框躲在屏幕外） */
function orbScrollIntoView(el) {
    try {
        if (!el || !el.scrollIntoView) return false;
        el.scrollIntoView({ block: 'nearest' });
        return true;
    } catch (e) { return false; }
}

function openOrb() {
    mountOrb();
    bindWbWatch();                            // 顺便重试挂「世界书被改了」的监听（首次常拿不到上下文）
    bindDlcMaskWatch();                       // 同一个道理：DLC↔面具 的生成前过滤也在这儿重试
    /* 球被收回（orbOn=false）时，从「扩展程序」栏开面板不该把球带出来 */
    try { const bb = document.getElementById('ssp_orb'); if (bb && getSettings().orbOn === false) bb.style.display = 'none'; } catch (e) { }
    const root = document.getElementById('ssp_orb_root');
    if (root && root.classList) root.classList.add('on');
    orbOpenNow = true; orbEditing = null;
    orbTabSqueeze.clear();                    // 换屏幕/横竖屏后重新算"放得下几个"
    renderOrbPanel();
    if (orbTab === 'dlc') orbDlcEnsure();     // 停在 DLC 页时按需拉那本书的条目
    return true;
}

function closeOrb() {
    const root = document.getElementById('ssp_orb_root');
    if (root && root.classList) root.classList.remove('on');
    orbOpenNow = false; orbEditing = null;
    /* 写卡块是借来的：关面板就还家（不然酒馆的右侧面板里会少一块） */
    try { orbEditorUnmount(); } catch (e) { }
    try { orbDbgPickOff(); } catch (e) { }
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

/** 锁住悬浮球的「皮肤」属性。
    ⚠️ 为什么必须这么干（实测过，不是猜）：
       酒馆自带主题 .Base_D / .Base_L 里有一条
         `*:not(#chat, #chat *, .avatar, .avatar *) { border-radius: var(--Radius) !important; }`
       而这两个主题把 --Radius 设为 0px。**`*` 选择器会把本扩展的球一起扫进去**，
       而且带 !important —— 所以切到这些主题时：
         · 球（本来 border-radius:50%）被抹成 0 → 看着"变方"
         · 里面的菱形（rotate(45deg) + radius:3px）也一起变
       我方 CSS 再怎么写选择器也压不过带 !important 的 `*`（特异性比不过通配符链）。
       所以改用**内联 !important**：内联的 !important 优先级高于任何外部 !important 规则。
       只锁几何/配色这几项，不动 left/top（那是 JS 按视口算的）和过渡。 */
function lockOrbSkin() {
    try {
        const ball = document.getElementById('ssp_orb');
        if (!ball || !ball.style || !ball.style.setProperty) return false;
        const P = (k, v) => ball.style.setProperty(k, v, 'important');
        P('width', '52px'); P('height', '52px');
        P('border-radius', '50%');
        P('background', 'linear-gradient(#1c1c22, #0e0e12)');
        P('border', '1px solid rgba(255,255,255,.22)');
        P('box-shadow', '0 6px 20px rgba(0,0,0,.5)');
        P('display', 'grid'); P('place-items', 'center');
        P('overflow', 'visible');            // 角标要露在球外面
        const dia = ball.querySelector('.ssp-orb-diamond');
        if (dia && dia.style && dia.style.setProperty) {
            const Q = (k, v) => dia.style.setProperty(k, v, 'important');
            Q('width', '20px'); Q('height', '20px');
            Q('transform', 'rotate(45deg)');
            Q('border-radius', '3px');
            Q('background', 'linear-gradient(135deg,#ffffff,#9a9aa2)');
            Q('box-shadow', 'inset 0 0 0 1px rgba(0,0,0,.35), 0 0 10px rgba(0,0,0,.45)');
        }
        return true;
    } catch (e) { return false; }
}

/** 把球的位置钳进视口。
    ⚠️ 为什么必须钳（真 bug）：位置存的是"离右边/下边的距离"，那是**当初那台设备的像素值**。
       用户在桌面上把球拖到某处（比如 right:554），换到手机上（视口 390 宽）算出来是
       left = 390 - 52 - 554 = **-216** → 球跑到屏幕左边外面，**根本点不到**，
       于是打不开鼠鼠口袋、也就"点不了世界书条目"（用户就是这么报的）。
       钳制后：位置先按比例缩放（多屏都合理），再夹在视口内保证一定看得见。 */
function orbClampEdge() {
    try {
        const W = Math.max(200, window.innerWidth || 0);
        const H = Math.max(200, window.innerHeight || 0);
        const vs = 52, pad = 6;
        const maxR = Math.max(pad, W - vs - pad);
        const maxB = Math.max(pad, H - vs - pad);
        let { right, bottom } = orbEdge || { right: 18, bottom: 96 };
        if (!isFinite(right)) right = 18;
        if (!isFinite(bottom)) bottom = 96;
        if (right > maxR) right = Math.round(right * (maxR / Math.max(right, 1)));
        if (bottom > maxB) bottom = Math.round(bottom * (maxB / Math.max(bottom, 1)));
        orbEdge = {
            right: Math.max(pad, Math.min(maxR, Math.round(right))),
            bottom: Math.max(pad, Math.min(maxB, Math.round(bottom))),
        };
    } catch (e) { }
    return orbEdge;
}
/** 按当前 orbEdge 把球摆好（挂载 / resize 共用） */
function orbPlaceBall() {
    const ball = document.getElementById('ssp_orb');
    if (!ball || !ball.style) return false;
    orbClampEdge();
    const w = ball.offsetWidth || 52, h = ball.offsetHeight || 52;
    ball.style.left = Math.round(window.innerWidth - w - orbEdge.right) + 'px';
    ball.style.top = Math.round(window.innerHeight - h - orbEdge.bottom) + 'px';
    ball.style.right = 'auto'; ball.style.bottom = 'auto';
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
    orbClampEdge();     // ⚠️ 挂载时也要钳；否则换到窄屏（手机）球会跑到屏幕外
    /* ① 球：直接挂 body（不进任何容器） */
    const ball = document.createElement('div');
    ball.className = 'ssp-orb';
    ball.id = 'ssp_orb';
    ball.title = '鼠鼠口袋（可拖动 · 点一下展开）';
    /* ⚠️ 位置不能用 CSS 的 bottom：酒馆里球的包含块高度会被算成 0，
       bottom:96px 于是变成 top:-148px（球飞到屏幕外，用户以为没有球）。
       实测 left/right 正常、坏的只有纵向 → 直接按视口把 left/top 算好写进去。 */
    ball.innerHTML = '<span class="ssp-orb-diamond"></span><span class="ssp-orb-badge" id="ssp_orb_badge"></span>';
    document.body.append(ball);
    lockOrbSkin();      // 锁皮肤：免得主题里那条带 !important 的 `*{border-radius:…}` 把球压成方的
    orbPlaceBall();     // 位置：先钳进视口再写（换窄屏时球不会跑到屏幕外）

    /* ③ 左下角「魔法棒」按钮：球的收纳口 —— 点一下把球收进去 / 再点放出来。
       球的展开与否存进设置（orbCollapsed），刷新后保持。 */
    const oldWand = document.getElementById('ssp_orb_wand'); if (oldWand) oldWand.remove();
    const wand = document.createElement('div');
    wand.className = 'ssp-orb-wand';
    wand.style.display = 'none';   /* 用户不要这个自建魔法棒；入口改挂到酒馆「扩展程序」展开栏 */
    wand.id = 'ssp_orb_wand';
    wand.setAttribute('data-orb-wand', '1');
    wand.title = '鼠鼠口袋：点一下把球收起来 / 放出来';
    wand.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
    document.body.append(wand);
    orbSetCollapsed(getSettings().orbCollapsed === true, true);

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

/** 魔法棒的位置：贴到酒馆自己的「扩展程序」按钮（#extensionsMenuButton）旁边。
    ⚠️ 不能把节点塞进那个 div —— 它靠 class 里的图标字体显示魔杖，塞东西会把图标撑坏。
    所以是"贴在它左边"，视觉上就是同一颗按钮的位置。找不到那个按钮就退回左下角。 */
function orbPlaceWand() {
    const wd = document.getElementById('ssp_orb_wand');
    if (!wd) return;
    const h = wd.offsetHeight || 34;
    let left = 14, top = Math.round(window.innerHeight - h - 14);
    try {
        const anchor = document.getElementById('extensionsMenuButton');
        if (anchor) {
            const r = anchor.getBoundingClientRect();
            if (r.width > 0) {
                left = Math.max(4, Math.round(r.left - h - 6));            // 贴在「扩展程序」按钮左边
                top = Math.round(r.top + r.height / 2 - h / 2);
            }
        }
    } catch (e) { }
    wd.style.left = left + 'px';
    wd.style.top = top + 'px';
    wd.style.right = 'auto';
    wd.style.bottom = 'auto';
}

/** 收纳 / 展开悬浮球（魔法棒控制；silent=true 时不弹提示、不落盘，用于初始化）
    ⚠️ 收纳时把球**移动到魔法棒的位置**再缩小淡出 —— 用户要的是"收进那颗魔法棒里"，
       不是原地消失。展开时再飞回原位（位置由 orbEdge 决定）。 */
function orbSetCollapsed(on, silent) {
    orbCollapsed = Boolean(on);
    const ball = document.getElementById('ssp_orb');
    const wand = document.getElementById('ssp_orb_wand');
    if (ball && ball.classList) ball.classList.toggle('ssp-collapsed', orbCollapsed);
    if (wand && wand.classList) wand.classList.toggle('active', orbCollapsed);
    if (ball) {
        if (orbCollapsed && wand) {
            /* 目标点 = 魔法棒中心（球缩到很小，所以直接用中心对齐即可） */
            const r = wand.getBoundingClientRect();
            const w = ball.offsetWidth || 52;
            ball.dataset.sspFly = '1';
            ball.style.left = Math.round(r.left + r.width / 2 - w / 2) + 'px';
            ball.style.top = Math.round(r.top + r.height / 2 - w / 2) + 'px';
        } else if (ball.dataset.sspFly) {
            /* 飞回原位（按离边距离算） */
            const w = ball.offsetWidth || 52, h = ball.offsetHeight || 52;
            ball.style.left = Math.round(window.innerWidth - w - orbEdge.right) + 'px';
            ball.style.top = Math.round(window.innerHeight - h - orbEdge.bottom) + 'px';
            delete ball.dataset.sspFly;
        }
    }
    if (!silent) {
        getSettings().orbCollapsed = orbCollapsed;
        save();
        toast(orbCollapsed ? '球已收进魔法棒（点魔法棒放出来）' : '球放出来了', 'info');
    }
    return orbCollapsed;
}

/** 换主题后保护一遍自己的两处外观：
     ① 球的皮肤（主题里带 !important 的 `*{border-radius:…}` 会把它压方）
     ② 卡片样式表（同一条规则会把卡片圆角抹平 → 重新注入一次带 !important 的版本）
    酒馆没有「主题已切换」事件导出，所以盯主题下拉 + 盯 body 的 class/style（主题会往 body 挂 class）。 */
function protectSkinAfterThemeChange() {
    /* v1.31.77：主题换了，面板配色得重新量一遍对比度（顺手把上次的结论作废） */
    try { sspSkinProbeLast = null; } catch (e) { }
    try { orbCtRows = null; } catch (e) { }   // v1.31.78：美化换了，体检要重跑
    [0, 120, 400].forEach(ms => setTimeout(() => {
        try { lockOrbSkin(); } catch (e) { }
        try { applyCardStyle(); } catch (e) { }
        try { sspSkinApply(); } catch (e) { }
    }, ms));
}

/** 换角色卡时重画面板。
    ⚠️ 之前只挂了 CHAT_CHANGED —— 所以在**角色列表里换卡**（没换聊天）时，
       面板还显示着上一个角色的绑定，看着就像"绑定没跟着卡走"。挂 CHARACTER_PAGE_LOADED 补上。
       酒馆落 characterId 是异步的，所以延后几次各刷一遍。 */
var orbLastCharId = null;
function orbOnCharChanged() {
    const now = (orbWbCurChar() || {}).id || '';
    if (now === orbLastCharId) return;
    orbLastCharId = now;
    orbWbAutoArmed = new Set();     // 换角色了，允许新角色重新套用一次
    /* 换角色了：存档页缓存的还是上一个角色的存档列表 —— 清掉并重拉
       （用户反馈：从角色卡列表直接切到另一张卡，存档列表不变）。
       顺带把预设/美化那两页也重画，它们同样是"当前角色"派生的。 */
    orbChatList = [];
    [0, 150, 500].forEach(ms => setTimeout(() => {
        orbLastCharId = (orbWbCurChar() || {}).id || '';
        if (!orbOpenNow) return;
        if (orbTab === 'chat') { try { orbChatsFetch(); } catch (e) { } return; }   // 它会自己重画
        if (orbTab === 'bg') { try { orbBgFetch(); } catch (e) { } return; } // 背景页：重拉列表（它自己会重画）
        renderOrbPanel();
    }, ms));
    if (now) [400, 1200].forEach(ms => setTimeout(() => { try { orbWbOnChatChanged(); } catch (e) { } }, ms));
    /* 背景：换角色/换聊天就要对齐，**不管面板开着哪一页**（之前只挂在"背景页开着"那个分支里，
       不在那页切卡压根不换 —— 真机 e2e 抓到的）。
       而且酒馆自己也会给这张卡套它的背景，所以我们要跑在它**后面**（900/1800ms 这两趟），不然会被盖掉。 */
    [900, 1800].forEach(ms => setTimeout(() => { try { orbBgSyncChar(true); } catch (e) { } }, ms));
}

/** 挂「世界书被改了」的监听 + 回到页面时的兜底重读。
    修的是这个毛病：在**酒馆自己的世界书编辑器**里改完，面板如果正停在那本书的条目页，
    原先要"切到别的书再切回来"（＝重新 fetch）才看到新内容。

    两条路一起上：
    ① 事件：酒馆保存时会 emit WORLDINFO_UPDATED（约 1 秒防抖）。
       ⚠️ 实测这套无头环境里**收不到**（同一个 eventSource、探针监听能收到、扩展的收不到），
       所以不能只靠它 —— 留着它没坏处，真机上多半是好的。
    ② 兜底：窗口/页面重新获得焦点时重读。用户在酒馆原生编辑器里改完再回到面板，
       一定会经过这一步，比事件更可靠。

    ⚠️ 挂载必须能**重试**：扩展初始化比酒馆上下文早得多，第一次调用时 getContext() 常是 null，
    所以除了绑定时试，打开面板 / 进世界书页 / 进 DLC 页时都会再试一次。 */
function bindWbWatch() {
    bindWbFocusWatch();
    if (bindWbWatch.done) return true;
    try {
        const c = getContext() || {};
        const es = c.eventSource, et = c.eventTypes;
        const evUpd = et && (et.WORLDINFO_UPDATED || 'worldinfo_updated');
        if (!es || typeof es.on !== 'function' || !evUpd) return false;   // 还没到位 → 下次再试
        bindWbWatch.done = true;
        es.on(evUpd, () => { orbWbReread('event'); });
        return true;
    } catch (e) { return false; }
}

/** 面板正停在「某本书的条目页」或「DLC 页」时，重新读一遍当前这本。
    why 参数只用于调试，方便日后查是哪条路生效的。 */
function orbWbReread(why) {
    try {
        if (!orbOpenNow) return false;
        if (orbTab === 'dlc') { orbDlcFetch(); return true; }
        if (orbTab !== 'world') return false;
        if (orbWbEntriesBook) { orbWbEntriesFetch(orbWbEntriesBook); return true; }
        renderOrbPanel();            // 书单页：也许刚新建/删了书
        return true;
    } catch (e) { return false; }
}

/** 兜底：窗口/标签页重新获得焦点时重读（用户去酒馆原生编辑器改完，回来就该看到新的） */
function bindWbFocusWatch() {
    if (bindWbFocusWatch.done) return true;
    bindWbFocusWatch.done = true;
    try {
        globalThis.addEventListener?.('focus', () => { orbWbReread('focus'); });
        document.addEventListener?.('visibilitychange', () => {
            if (document.visibilityState === 'visible') orbWbReread('visible');
        });
    } catch (e) { }
    return true;
}

/** "刚刚有一次会改变面板显隐的点击"：用来吞掉浏览器补发的那一发**合成 click**。
     · scope='in'  ：点球**开**面板 → 幽灵 click 落在面板里刚出现的内容上
                    （用户报的"点一下悬浮窗 → 世界书条目被算成点了两次"）
     · scope='out' ：点关闭/遮罩**关**面板 → 幽灵 click 落在面板下面酒馆的界面上
    都只吞**第一发**、且有时间窗，不会影响用户真正的下一次点击。 */
let orbGhostUntil = 0;
let orbGhostScope = '';

function bindOrb() {
    if (bindOrb.done) return false;
    bindOrb.done = true;
    const getBall = () => document.getElementById('ssp_orb');
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;

    try {
        const sel = document.getElementById('themes');
        if (sel && !bindOrb.themeBound) {
            bindOrb.themeBound = true;
            sel.addEventListener('change', protectSkinAfterThemeChange);
        }
        if (window.MutationObserver && document.body && !bindOrb.skinObs) {
            bindOrb.skinObs = true;
            let t = 0;
            new MutationObserver(() => {
                if (t) return;
                t = setTimeout(() => { t = 0; protectSkinAfterThemeChange(); }, 60);
            }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
        }
    } catch (e) { }

    /* 兜底轮询：面板开着时，只要「当前聊天角色」和上次记的不一样就重画。
       解决换卡后面板还显示上一个角色的问题（事件有时序问题，轮询最省心，也很轻）。 */
    try {
        if (!bindOrb.charPoll) {
            bindOrb.charPoll = true;
            setInterval(() => {
                if (!orbOpenNow) return;
                const now = (orbWbCurChar() || {}).id || '';
                if (now !== orbLastCharId) orbOnCharChanged();
            }, 1200);
        }
    } catch (e) { }

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
                    /* 切聊天时先看要不要自动换预设 / 自动换美化 / 自动套用世界书 */
                    if (k === 'CHAT_CHANGED') {
                        try { orbPresetAutoApply(); } catch (e) { }
                        try { orbThemeAutoApply(); } catch (e) { }
                        try { orbWbOnChatChanged(); } catch (e) { }
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

    /* 世界书被改了（谁改的都算）→ 面板开着就跟着更新。真正的挂载在 ensureWbWatch() 里，
       这里只是尽早试一次（那时酒馆上下文常常还没到位，所以它自己会重试）。 */
    bindWbWatch();
    bindDlcMaskWatch();

    /* v1.31.63：窗口/横竖屏变了 → 重新算"页签放得下几个"（挤进「…」的只是内存状态，不能留着） */
    try {
        if (!bindOrb.resizeBound) {
            bindOrb.resizeBound = true;
            let rzTimer = 0;
            globalThis.addEventListener?.('resize', () => {
                if (!orbOpenNow) return;
                try { globalThis.clearTimeout(rzTimer); } catch (e) { }
                rzTimer = globalThis.setTimeout?.(() => {
                    orbTabSqueeze.clear();
                    try { renderOrbPanel(); } catch (e) { }
                }, 160);
            });
            globalThis.addEventListener?.('orientationchange', () => {
                orbTabSqueeze.clear();
                if (orbOpenNow) { try { renderOrbPanel(); } catch (e) { } }
            });
        }
    } catch (e) { }

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
        /* ⚠️ 修「点一下球 → 世界书条目被算成点了两次」：
           手机点球是"触摸"，浏览器在 pointerup 之后还会补发一次**合成 click**；
           球是在 pointerup 里开/关面板的 → 面板瞬间出现在手指底下 →
           那一发合成 click 就落到了**刚显示出来的面板内容**上（于是世界书条目被点了两次）。
           按规范"取消 pointerdown 会抑制后续兼容鼠标事件"，但实测在 Chrome 里
           **它会把后面的 pointermove 也掐掉 → 球拖不动**，所以不能用。
           改用下面那道 **click 捕获阶段的"吞一发"**：只吞"跟这次显隐同方向"的第一发 click。

        ⚠️ v1.31.68：**只在触摸/笔上布防**。桌面鼠标点球不会产生"合成 click"，以前也照着布防了 →
           用户"点球开面板、紧接着点一张卡"的第一下被吞掉，表现就是
           「刚进酒馆点对话点不动，进过一次聊天才正常」这种很怪的现象。 */
        const isTouch = String(ev.pointerType || '') !== 'mouse';
        if (isTouch) {
            orbGhostUntil = Date.now() + 600;
            orbGhostScope = 'in';                 // 开面板 → 吞"面板内"的第一发幽灵 click
        }
        const r = o.getBoundingClientRect();
        dragging = true; moved = false;
        sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top;
        try { o.setPointerCapture(ev.pointerId); } catch (e) { }
    }, true);
    /* 兜底：跟着"这次点击改变了面板显隐"的那一发幽灵 click，直接吞掉（只吞一发、有时间窗）。
       · scope='in'  → 点球开面板：吞落在**面板内**的那一发
       · scope='out' → 点关闭/遮罩关面板：吞落在**面板外**（下面酒馆界面上）的那一发 */
    document.addEventListener('click', ev => {
        if (!orbGhostUntil || Date.now() > orbGhostUntil) { orbGhostUntil = 0; orbGhostScope = ''; return; }
        const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        const inPanel = !!(t && t.closest && t.closest('#ssp_orb_root, #ssp_orb_panel'));
        if (orbGhostScope === 'in' && !inPanel) return;      // 方向不对 → 那是用户的真点击，放行
        if (orbGhostScope === 'out' && inPanel) return;
        orbGhostUntil = 0; orbGhostScope = '';
        try { ev.stopPropagation(); } catch (e) { }
        try { ev.preventDefault(); } catch (e) { }
        try { ev.stopImmediatePropagation(); } catch (e) { }
    }, true);

    document.addEventListener('pointermove', ev => {
        if (!dragging) return;
        const o = getBall(); if (!o) return;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;      // 点一下别被当成拖动
        moved = true;
        /* ⚠️ 这一句要加在写 left/top **之前**：.moving 会把 left/top 的过渡掐掉（见 style.css），
           否则球会慢半拍追着指针跑（用户反馈的"拖动手感粘滞"）。 */
        if (o.classList) o.classList.add('moving');
        const w = o.offsetWidth || 52, h = o.offsetHeight || 52;
        const x = Math.max(4, Math.min(window.innerWidth - w - 4, ox + dx));
        const y = Math.max(4, Math.min(window.innerHeight - h - 4, oy + dy));
        o.style.left = Math.round(x) + 'px'; o.style.top = Math.round(y) + 'px';
        o.style.right = 'auto'; o.style.bottom = 'auto';
    }, true);

    document.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        const o = getBall(); if (!o) return;
        if (o.classList) o.classList.remove('moving');
        if (moved) {
            const r = o.getBoundingClientRect();
            orbEdge = { right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom) };
            orbClampEdge();
            getSettings().orbPos = { right: Math.max(0, orbEdge.right), bottom: Math.max(0, orbEdge.bottom) };
            save();
            orbPlaceBall();      // 拖到边缘外也保证回到可见范围
        } else if (orbOpenNow) closeOrb(); else openOrb();
    }, true);

    /* 面具页搜索：只换列表那一块（输入框不重画，焦点和光标都不会丢） */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (el && el.dataset && el.dataset.sspQbnum) {
            const k = el.dataset.sspQbnum;
            const v = k === 'opacity' ? Number(el.value) / 100 : Number(el.value);
            quickBarSettings()[k] = v;
            const out = document.querySelector('[data-ssp-qbout="' + k + '"]');
            if (out) out.textContent = (k === 'opacity' ? Math.round(Number(el.value)) + '%' : Math.round(Number(el.value)) + 'px');
            qbMount();
            return;
        }
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

    /* 番外页搜索 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbNsearch === undefined) return;
        orbNSearch = el.value || '';
        const box = document.getElementById('ssp_orb_notes_list');
        if (box) box.innerHTML = orbNoteRowsHTML();
        const bar = document.querySelector('.ssp-orb-pfilter');
        if (bar) {
            let c = bar.querySelector('[data-orb-nclear]');
            if (orbNSearch && !c) { c = document.createElement('span'); c.className = 'ssp-pbtn'; c.setAttribute('data-orb-nclear', '1'); c.textContent = '清除'; bar.append(c); }
            else if (!orbNSearch && c) c.remove();
        }
    });

    /* 存档页搜索 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbChsearch === undefined) return;
        orbChSearch = el.value || '';
        const box = document.getElementById('ssp_orb_chat_list');
        if (box) box.innerHTML = orbChatRowsHTML();
    });

    /* 背景页：搜索（只换列表那一块，输入框不丢焦点） */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbBgsearch === undefined) return;
        orbBgSearch = el.value || '';
        const box = document.getElementById('ssp_orb_bglist');
        if (box) box.innerHTML = orbBgRowsHTML();
    });
    /* 背景页：选了文件就上传 */
    document.addEventListener('change', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset) return;
        if (el.dataset.orbBgfile !== undefined) {
            const f = el.files && el.files[0];
            el.value = '';
            if (f) orbBgUpload(f).then(() => { if (orbOpenNow) renderOrbPanel(); });
            return;
        }
        if (el.dataset.orbBgauto !== undefined) {
            const s = getSettings();
            s.bgAuto = !!el.checked;
            save();
            if (s.bgAuto) { try { orbBgSyncChar(true); } catch (e) { } }
            toast(s.bgAuto ? '换角色会自动切背景' : '换角色不再动背景', 'info');
        }
    });

    /* 美化页搜索 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
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

    /* 美化「编辑口」的 CSS 框：**每敲一下就直接写进酒馆的 #custom-style → 实时看到效果**。
       ⚠️ 这里绝不重画面板（一重画 textarea 就重建、光标和焦点全丢）。 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbThcss === undefined) return;
        orbThemeDraft = String(el.value || '');
        orbThemePreview(orbThemeDraft);
    });

    /* 「选卡」页签搜索：只重画列表那一块，不重画面板（免得输入框失焦） */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbPicksearch === undefined) return;
        orbPickSearch = String(el.value || '');
        const panel = document.getElementById('ssp_orb_panel');
        if (!panel) return;
        const body = panel.querySelector('.ssp-orb-body');
        if (!body) return;
        const keep = body.scrollTop;
        body.innerHTML = orbPickHTML();
        body.scrollTop = keep;
    });

    /* 「调试」页签的脚本框：只存内容，**绝不重画面板**（重画会丢焦点和光标位置） */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.sspDbgcode === undefined) return;
        orbDbgCode = String(el.value || '');
    });
    /* Ctrl/Cmd+Enter 在脚本框里直接跑 */
    document.addEventListener('keydown', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.sspDbgcode === undefined) return;
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); orbDbgRun(); }
    });

    /* 预设页搜索 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
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

    /* 世界书页：换一张角色卡来配（下拉框走 change，不是 click） */
    document.addEventListener('change', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbWchar === undefined) return;
        orbWbBinding = el.value || null;
        renderOrbPanel();
    });

    /* 分类：改名（失焦/回车提交；重名或空名就还原）。世界书和番外共用这套属性 */
    document.addEventListener('change', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbCatrename === undefined) return;
        const from = el.dataset.orbCatrename;
        const to = String(el.value || '').trim();
        if (!to || to === from) { el.value = from; return; }
        const isNotes = (orbTab === 'notes');
        const ok = isNotes ? orbNoteCatRename(from, to) : orbWbCatRename(from, to);
        if (!ok) { toast('「' + to + '」已经存在了', 'warning'); el.value = from; return; }
        toast('分类改名：' + from + ' → ' + to, 'success');
        renderOrbPanel();
    });

    /* 数据页：勾选要导哪几类（复选框走 change，不是 click —— click 时状态还没翻） */
    document.addEventListener('change', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset) return;
        if (el.dataset.orbDatacat !== undefined) {
            orbDataPick[el.dataset.orbDatacat] = !!el.checked;
            renderOrbPanel();
            return;
        }
        if (el.dataset.orbDatacatimp !== undefined) {
            orbImpPick[el.dataset.orbDatacatimp] = !!el.checked;
            renderOrbPanel();
            return;
        }
        /* 选备份包（file input 的 change） */
        if (el.dataset.orbDataimportfile !== undefined) {
            const f = el.files && el.files[0];
            try { el.value = ''; } catch (e) { }
            if (f) orbImpRead(f);
        }
    });

    /* 世界书页搜索。
       ⚠️ 这里跟番外/面具页不一样，**整页重画**而不是只换列表：
       分类标签栏上的计数（共 N 本）和上面那行「筛出 X / Y」都得跟着搜索词变，
       只换列表的话标签栏会停在旧数字上（自己踩过）。代价是输入框会失焦一次。 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbWsearch === undefined) return;
        orbWbSearch = el.value || '';
        renderOrbPanel();
        const again = document.querySelector('[data-orb-wsearch]');
        if (again) { try { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } catch (e) { } }
    });

    /* 世界书栏「条目页」搜索 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbEnesearch === undefined) return;
        orbWbEntrySearch = el.value || '';
        const box = document.getElementById('ssp_orb_wbent_list');
        if (box) box.innerHTML = orbEntryListHTML({
            entries: orbWbEntries, book: orbWbEntriesBook, editing: orbWbEntryOpen, kind: 'book',
            search: orbWbEntrySearch, loaded: orbWbEntriesLoaded, err: orbWbEntriesErr,
        });
        const bar = document.querySelector('.ssp-orb-pfilter');
        if (bar) {
            let c = bar.querySelector('[data-orb-eneclear]');
            if (orbWbEntrySearch && !c) { c = document.createElement('span'); c.className = 'ssp-pbtn'; c.setAttribute('data-orb-eneclear', '1'); c.textContent = '清除'; bar.append(c); }
            else if (!orbWbEntrySearch && c) c.remove();
        }
    });

    /* v1.31.72 主题变量：输入 / 拖滑块就立刻生效（颜色、滑块、文本框都走这一条） */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset) return;
        if (el.dataset.orbTvsearch !== undefined) {
            orbTVSearch = el.value || '';
            const host = sspTabRoot().querySelector('#ssp_orb_panel [data-orb-tvbody]');
            if (host) host.innerHTML = orbThemeVarsHTML(); else renderOrbPanel();
            return;
        }
        const k = el.dataset.orbTvk;
        if (!k) return;
        let v;
        if (el.type === 'range') v = String(el.value) + String(el.dataset.orbTvunit || '');
        else v = String(el.value == null ? '' : el.value);
        try {
            themeVarsOf()[k] = v;
            save();
            themeVarsApply();
            const out = sspTabRoot().querySelector('#ssp_orb_panel [data-orb-tvout="' + k + '"]');
            if (out) out.textContent = v;
            const row = el.closest('[data-orb-tvrow]');
            if (row && !row.classList.contains('changed')) row.classList.add('changed');
        } catch (e) { }
    });

    /* DLC 页搜索 */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbDlcsearch === undefined) return;
        orbDlcSearch = el.value || '';
        const box = document.getElementById('ssp_orb_dlc_list');
        if (box) box.innerHTML = orbDlcRowsHTML();
        const bar = document.querySelector('.ssp-orb-pfilter');
        if (bar) {
            let c = bar.querySelector('[data-orb-dlcclear]');
            if (orbDlcSearch && !c) { c = document.createElement('span'); c.className = 'ssp-pbtn'; c.setAttribute('data-orb-dlcclear', '1'); c.textContent = '清除'; bar.append(c); }
            else if (!orbDlcSearch && c) c.remove();
        }
    });

    /* v1.31.60 查找页：只重画结果那一块（输入框不重画 → 焦点和光标不丢） */
    document.addEventListener('input', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbFindq === undefined) return;
        orbFindQ = el.value || '';
        orbFindCur = -1;
        orbFindShow = 100;                    // 关键字变了 → 列表回到第一屏
        const box = document.getElementById('ssp_orb_find_body');
        if (box) box.innerHTML = orbFindBodyHTML();
        const bar = el.closest('.ssp-orb-pfilter');
        if (bar) {
            let c = bar.querySelector('[data-orb-findclear]');
            if (orbFindQ && !c) { c = document.createElement('span'); c.className = 'ssp-pbtn'; c.setAttribute('data-orb-findclear', '1'); c.textContent = '清除'; bar.append(c); }
            else if (!orbFindQ && c) c.remove();
        }
    });
    /* 查找页：回车 = 跳到第一条命中 */
    document.addEventListener('keydown', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset || el.dataset.orbFindq === undefined) return;
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const list = findRows();
        if (!list.length) { toast('没有可跳的消息', 'info'); return; }
        orbFindCur = 0;
        orbFindGo(list[0].id);
        if (orbOpenNow && orbTab === 'find') renderOrbPanel();
    });

    /* 条目编辑器里的联动（常驻 ↔ 触发词 / 更多设置） */
    document.addEventListener('change', ev => {
        const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!el || !el.dataset) return;
        if (el.dataset.sspEnf === 'constant' || el.dataset.sspEnf === 'adv') {
            orbEntryFormCascade(el.closest('[data-ssp-enform]'));
        }
    });

    document.addEventListener('click', ev => {
        const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-orb-pclear]')) { orbPSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-close]')) {
            /* 关面板这一下也会带一发合成 click，落在面板**下面**的酒馆界面上 → 布 out 窗口吞掉它 */
            orbGhostUntil = Date.now() + 450; orbGhostScope = 'out';
            closeOrb(); return;
        }
        /* 收回悬浮球：按钮就在面板里（用户要求做在球自己里面） */
        /* 顶栏：调试窗（大部分人用不到，所以做在收回按钮旁边的小图标） */
        if (t.closest('[data-orb-dbgopen]')) { orbDbgOpenWin(); return; }
        /* ---- 「选卡」页签 ---- */
        {
            /* 卡的列表/墙视图切换、分组筛选、上下移、改分组 */
            const cv = t.closest('[data-ccardview]');
            if (cv) { orbPickView = cv.dataset.ccardview || 'list'; chCardEdit = ''; renderOrbPanel(); return; }
            const cp = t.closest('[data-ccardpick]');
            if (cp) { orbPickGroup = cp.dataset.ccardpick || ''; chCardEdit = ''; renderOrbPanel(); return; }
            const cu = t.closest('[data-ccardup]');
            if (cu) { chCardMove(cu.dataset.ccardup, -1, chPickCurList()); return; }
            const cd = t.closest('[data-ccarddown]');
            if (cd) { chCardMove(cd.dataset.ccarddown, 1, chPickCurList()); return; }
            const cg = t.closest('[data-ccardgrp]');
            if (cg) {
                const av = cg.dataset.ccardgrp;
                chCardEdit = (chCardEdit === av) ? '' : av;
                renderOrbPanel();
                return;
            }
        }
        /* 设置面板里的「去常用开关」：关掉设置面板 → 打开鼠鼠口袋的「美化」页 → 顺手展开那一栏 */
        if (t.closest('[data-ssp-qbgoto]')) {
            try { closeSettingsPanel(); } catch (e) { }
            try { orbBeautyOpen = true; } catch (e) { }
            try { orbTab = 'theme'; openOrb(); renderOrbPanel(); } catch (e) { }
            return;
        }
        if (t.closest('[data-chsave]')) { chSave(); return; }
        if (t.closest('[data-chfav]')) { chNative('favorite_button'); return; }
        if (t.closest('[data-chadv]')) { chNative('advanced_div'); return; }
        /* 「…更多」：展开/收起那一排我们自己的图标按钮（原生按钮一颗都不搬） */
        {
            const mb = t.closest('[data-chmore]');
            if (mb) {
                const box = sspTabRoot().querySelector('#ssp_orb_panel [data-chmorebox]');
                if (box) {
                    box.hidden = !box.hidden;
                    mb.classList.toggle('on', !box.hidden);
                }
                return;
            }
        }
        /* 「备选开场白」那一行右上角的「原生面板」小按钮（兼容旧的 data-choverlay 用法） */
        if (t.closest('[data-chgreetnative]')) { chNative('open_alternate_greetings'); return; }
        /* ---- 「备选开场白」列表：加 / 上移下移 / 删 / 分组筛选 / 展开 ---- */
        {
            if (t.closest('[data-chgadd]')) { chGreetAdd(); return; }
            const gp = t.closest('[data-chgpick]');
            if (gp) { chGreetPick = gp.dataset.chgpick || ''; chGreetOpen = -1; chGreetRender(); return; }
            const gu = t.closest('[data-chgup]');
            if (gu) { chGreetMove(Number(gu.dataset.chgup), -1); return; }
            const gd = t.closest('[data-chgdown]');
            if (gd) { chGreetMove(Number(gd.dataset.chgdown), 1); return; }
            const gx = t.closest('[data-chgdel]');
            if (gx) { chGreetDel(Number(gx.dataset.chgdel)); return; }
            const gt = t.closest('[data-chgtoggle]');
            if (gt) {
                if (t.closest('[data-chgup],[data-chgdown],[data-chgdel]')) return;   // 别把操作当展开
                const i = Number(gt.dataset.chgtoggle);
                chGreetOpen = (chGreetOpen === i) ? -1 : i;
                chGreetRender();
                return;
            }
        }
        {
            const ov = t.closest('[data-choverlay]');
            if (ov) { chOverlay(ov.dataset.choverlay); return; }
            const nv = t.closest('[data-chnative]');
            if (nv) { chNative(nv.dataset.chnative); return; }
            const av = t.closest('[data-chavbtn]');
            if (av) {
                /* 头像：**不自己实现文件选择**，去点酒馆自己的 file 控件 ——
                   格式转换、裁剪、预览、上传那条链一个字都不用改（见文件头"接口层③"）。
                   ⚠️ 优先点 **file input 本身**：`#avatar_div_div`（那个 label）现在被我们
                      CSS 藏起来了，点一个 display:none 的 label 在部分浏览器里不会弹选择框；
                      而在同一个用户手势里对 file input 调 .click() 是标准做法。 */
                const inp = document.getElementById('add_avatar_button');
                const lab = document.getElementById('avatar_div_div');
                if (inp && inp.click) { try { inp.click(); } catch (e) { } }
                else if (lab && lab.click) { try { lab.click(); } catch (e) { } }
                else toast('找不到酒馆的头像控件', 'warning');
                return;
            }
        }
        if (t.closest('[data-orb-chnew]')) { orbCardNew(); return; }
        if (t.closest('[data-orb-chtolist]')) { orbOpenNativeList(); return; }
        if (t.closest('[data-orb-pickclear]')) { orbPickSearch = ''; renderOrbPanel(); return; }
        {
            const pm = t.closest('[data-orb-pickmode]');
            if (pm) { orbPickMode = pm.dataset.orbPickmode || 'recent'; renderOrbPanel(); return; }
            const pc = t.closest('[data-orb-chpick]');
            if (pc) {
                orbCardOpen(pc.dataset.orbChpick);
                /* ⚠️ 顺序很重要：先切到写卡页签（#ssp_editor_box 才会存在），再轮询把块搬进来。
                   还要按"酒馆自己点卡会重建写卡块"的实测行为等一会儿（见 orbCardOpen 注释）。 */
                setTimeout(() => { try { orbEditorOpen(); } catch (e) { } }, 350);
                orbEditorMountSoon(24);
                return;
            }
        }
        /* ---- 「写卡」页签里的分页切换 ---- */
        {
            const ct = t.closest('[data-orb-cftab]');
            if (ct) {
                /* 离开这一页前先把改动落回原生（页签之间来回切不该丢字） */
                try { chPush(true); } catch (e) { }
                chTab = ct.dataset.orbCftab || 'persona';
                /* ⚠️ v1.31.70：这里原来只做 `chPanesLoad(true)`（局部重画分页）。
                   进了影子根以后，那条路径里的某一步会抛（页签亮了、内容不换），
                   用户看到的就是「点对话切不过去，必须关掉口袋再打开」。
                   改成**整页重画**：renderOrbPanel 里调 chPanesLoad 是包在 try/catch 里的，
                   一条出错也不会挡住整页渲染。 */
                renderOrbPanel();
                return;
            }
        }
        /* v1.31.72 主题变量：取值 / 还原 / 写回 / 搜索 / 折叠 */
        const tvRow = t.closest('[data-orb-tvrow]');
        if (tvRow) {
            /* 行里除 ↺ 以外的控件点击都交给 input 处理（这里只挡掉冒泡误判） */
        }
        const tvr = t.closest('[data-orb-tvr]');
        if (tvr) {
            const k = tvr.dataset.orbTvr;
            const ov = themeVarsOf();
            delete ov[k]; save(); themeVarsApply(); renderOrbPanel();
            toast('已还原 ' + k, 'info');
            return;
        }
        if (t.closest('[data-orb-tvall]')) {
            const b = themeVarsBinds();
            delete b[String(orbThemeCur() || '(未命名)')];
            save(); themeVarsApply(); renderOrbPanel();
            toast('已把所有变量还原成主题原值', 'success');
            return;
        }
        if (t.closest('[data-orb-tvwrite]')) { themeVarsWriteBack(); renderOrbPanel(); return; }
        if (t.closest('[data-orb-tvfold]')) { orbTVOpen = !orbTVOpen; renderOrbPanel(); return; }
        if (t.closest('[data-orb-tvsearchclear]')) { orbTVSearch = ''; renderOrbPanel(); return; }
        /* v1.31.79：中文化 —— 改中文名 / 显示原名 / 词表 */
        const rename = t.closest('[data-orb-tvrename]');
        if (rename) {
            const k = rename.dataset.orbTvrename;
            let val = null;
            try {
                val = globalThis.prompt ? globalThis.prompt('给 ' + k + ' 起个中文名（留空＝用词典/原名）', sspVarAliasOf(k) || sspVarNameCN(k) || '') : null;
            } catch (e) { val = null; }
            if (val === null) return;                      // 取消
            sspVarAliasSet(k, val);
            renderOrbPanel();
            toast(String(val).trim() ? ('已改名：' + String(val).trim()) : '已恢复默认名字', 'success');
            return;
        }
        if (t.closest('[data-orb-tvraw]')) {
            const s = getSettings();
            s.varShowRaw = (s.varShowRaw === false);
            save();
            renderOrbPanel();
            return;
        }
        const catBtn = t.closest('[data-orb-tvcat]');
        if (catBtn) { orbTVCat = catBtn.dataset.orbTvcat; renderOrbPanel(); return; }
        if (t.closest('[data-orb-tvdict]')) { orbTVDictOpen = !orbTVDictOpen; renderOrbPanel(); return; }
        if (t.closest('[data-orb-tvjsonload]')) {
            const box = document.querySelector('#ssp_orb_panel [data-orb-tvjson]');
            const r = sspVarDictLoad(box ? box.value : '');
            if (r.ok) { orbTVDictOpen = false; renderOrbPanel(); }
            toast(r.msg, r.ok ? 'success' : 'error');
            return;
        }
        if (t.closest('[data-orb-tvjsondown]')) {
            try {
                const blob = new Blob([sspVarDictJSON()], { type: 'application/json' });
                orbDataDownload(blob, '鼠鼠变量词表-' + String(orbThemeCur() || '当前美化').replace(/[\\/:*?"<>|]/g, '_') + '.json');
                toast('词表已导出（也可以直接把文本框里的内容复制走）', 'success');
            } catch (e) { toast('导出失败：' + (e && e.message), 'warning'); }
            return;
        }
        if (t.closest('[data-orb-tvjsonreset]')) {
            getSettings().varDictUser = {};
            save();
            renderOrbPanel();
            toast('词典已恢复成内置的（别名没动）', 'success');
            return;
        }
        /* 调试页签里的按钮（以前是独立窗口自己接监听；现在是页签，走面板委托）---- */
        if (t.closest('[data-ssp-dbgclose]')) { orbDbgClose(); return; }
        if (t.closest('[data-ssp-dbgclear]')) { orbDbgClear(); return; }
        {
            const dload = t.closest('[data-ssp-dbgload]');
            if (dload) {
                const item = orbDbgStore()[Number(dload.dataset.sspDbgload)];
                if (item) { orbDbgCode = String(item.code || ''); orbDbgName = item.name; orbDbgTab = 'script'; renderOrbPanel(); toast('已装载脚本：' + item.name, 'success'); }
                return;
            }
            const ddrop = t.closest('[data-ssp-dbgdrop]');
            if (ddrop) {
                const i = Number(ddrop.dataset.sspDbgdrop);
                const list = orbDbgStore();
                const gone = list.splice(i, 1)[0];
                save();
                toast('已删脚本：' + ((gone && gone.name) || i), 'info');
                orbDbgListScripts();
                return;
            }
            if (t.closest('[data-ssp-dbgcopy]')) {
                const txt = orbDbgText() || orbDbgOut.join('\n');
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(txt).then(() => toast('输出已复制到剪贴板', 'success'), () => orbDbgFallbackCopy(txt));
                    } else orbDbgFallbackCopy(txt);
                } catch (e) { orbDbgFallbackCopy(txt); }
                return;
            }
            const dbgTab = t.closest('[data-ssp-dbgtab]');
            if (dbgTab) {
                orbDbgTab = dbgTab.dataset.sspDbgtab || 'script';
                if (orbDbgTab !== 'pick') { try { orbDbgPickOff(); } catch (e) { } }
                renderOrbPanel();                        // 重画这一页（子页签的高亮、脚本框/抓元素说明都跟着换）
                /* 「抓元素」子页签：切过去不自动进抓取模式 —— 给一个明确的「开始抓取」按钮，
                   免得用户只是想看看就被拉进抓取（手机上"关不掉"的观感来源） */
                return;
            }
            if (t.closest('[data-ssp-dbgrun]')) { orbDbgRun(); return; }
            if (t.closest('[data-ssp-dbgsave]')) { orbDbgSaveScript(); return; }
            if (t.closest('[data-ssp-dbgsaved]')) { orbDbgListScripts(); return; }
            const dg = t.closest('[data-ssp-dbgdiag]');
            if (dg) { orbDbgDiag(dg.dataset.sspDbgdiag); return; }
            if (t.closest('[data-ssp-dbgpickstart]')) { orbDbgPickStart(); return; }
        }
        if (t.closest('[data-orb-retract]')) {
            getSettings().orbOn = false; save();
            orbSetCollapsed(true, true);
            closeOrb();
            const b2 = document.getElementById('ssp_orb');
            if (b2) setTimeout(() => { try { b2.style.display = 'none'; } catch (e) { } }, 260);
            toast('球已收回。想再拿回来：扩展 → 🐭 鼠鼠小助手 → 打开鼠鼠面板 → 勾上「显示悬浮球」', 'info');
            return;
        }
        /* 美化页：清除搜索 / 返回 / 用这个 / 绑定 / 选角色 / 自动开关 / 编辑口 */
        if (t.closest('[data-orb-thclear]')) { orbThSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-themeback]')) { orbThemeBinding = null; renderOrbPanel(); return; }
        /* ---- 美化「编辑口」----
           ⚠️ 这些判断要放在下面「用这个 / 绑定」**前面**：那些按钮跟编辑按钮不在同一行，
           但统一先判细粒度动作更保险（这个仓库里已经被同类问题坑过 4 次）。 */
        if (t.closest('[data-orb-thedit]')) {
            orbThemeEdit = true;
            orbThemeDraft = null;              // 重新从酒馆那份读
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-theditdone]')) {
            /* 离开编辑：先把最后一次输入同步给酒馆（等于"顺手存一下"），
               再把预览刷成酒馆那份，别把没保存的改动留在页面上；
               但**草稿留着** —— 下次进来还能接着改（用户预期"我改的东西还在"）。 */
            const css = orbThemeCss();
            orbThemeSyncToSt(css);
            orbThemePreview(css);
            orbThemeEdit = false;
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-thcssreset]')) {
            const ta = document.getElementById('customCSS');
            orbThemeDraft = ta ? ta.value : '';
            orbThemeSyncToSt(orbThemeDraft);
            orbThemePreview(orbThemeDraft);
            renderOrbPanel();
            toast('已还原成酒馆里存的那份', 'info');
            return;
        }
        if (t.closest('[data-orb-thcssupdate]')) {
            const css = orbThemeCss();
            orbThemeSyncToSt(css);             // 先让 power_user.custom_css 跟上
            orbThemePreview(css);
            if (orbThemeClickSt('ui-preset-update-button')) toast('已更新当前美化', 'success');
            /* ⚠️ 这里**不能** orbThemeDraft = null：清掉之后同步就会退回读 textarea 的旧值，
               返回再进来看到的也是旧的（实测抓到）。草稿要一直留着。 */
            renderOrbPanel();
            return;
        }
        /* 新建美化：把"现在这套设置 + 你改的 CSS"存成一个新主题（走酒馆的 /api/themes/save） */
        if (t.closest('[data-orb-thcreate]')) {
            const css = orbThemeCss();
            orbThemeCreate('', css).then(nm => { if (nm) { orbThemeEdit = false; renderOrbPanel(); } });
            return;
        }
        if (t.closest('[data-orb-thexport]')) {
            orbThemeClickSt('ui_preset_export_button');
            toast('导出当前美化（酒馆会下载 json）', 'info');
            return;
        }
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
        /* ---- 分类（文件夹）：世界书 / 番外共用这套 data-orb-cat* 属性 ----
           ⚠️ 哪一页在工作**由 DOM 自己表明**（番外的元素带 data-orb-catkind="notes"），
           不去读 orbTab —— 面板可能停在某个模块上、也可能因为别的原因跟真实页面不同步。
           ⚠️ 必须放在「点书名＝绑定」「📖 展开条目」「点整行＝开关」**前面**：
           分类按钮长在那一行**里面**，行本身也可点，先判细的才不会误触发。 */
        const isNotesEl = (el) => !!(el && el.dataset && el.dataset.orbCatkind === 'notes');
        const catTab = t.closest('[data-orb-cat]');
        if (catTab) {
            const v = catTab.dataset.orbCat || '';
            if (isNotesEl(catTab)) orbNCat = v; else orbWbCat = v;
            orbCatClearPickers();
            renderOrbPanel();
            return;
        }
        const catPick = t.closest('[data-orb-catpick]');
        if (catPick) {
            const n = catPick.dataset.orbCatpick;
            const notes = isNotesEl(catPick);
            const same = notes ? (orbNCatPick === n) : (orbWbCatPick === n);
            orbCatClearPickers();
            if (notes) orbNCatPick = same ? null : n;
            else orbWbCatPick = same ? null : n;
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-catclose]')) { orbCatClearPickers(); renderOrbPanel(); return; }
        const catEdit = t.closest('[data-orb-catedit]');
        if (catEdit) {
            if (isNotesEl(catEdit)) orbNCatEdit = !orbNCatEdit; else orbWbCatEdit = !orbWbCatEdit;
            renderOrbPanel();
            return;
        }
        const catSet = t.closest('[data-orb-catset]');
        if (catSet) {
            const id = catSet.dataset.orbCatset;
            const cat = catSet.dataset.cat || '';
            if (isNotesEl(catSet)) orbNoteCatSet(id, cat); else orbWbCatSet(id, cat);
            orbCatClearPickers();
            toast('已归到「' + (cat || '未分类') + '」', 'success');
            renderOrbPanel();
            return;
        }
        /* 就地「新建分类并归入」：展开输入框 → 点「建好并归入」提交（不弹窗，手机上更快） */
        const catNew = t.closest('[data-orb-catpicknew]');
        if (catNew) {
            const n = catNew.dataset.orbCatpicknew;
            const notes = isNotesEl(catNew);
            orbCatClearPickers();
            if (notes) orbNCatNew = n; else orbWbCatNew = n;
            renderOrbPanel();
            requestAnimationFrame(() => {
                const inp = document.querySelector('.ssp-catnewin');
                if (inp) { try { inp.focus(); } catch (e) { } }
            });
            return;
        }
        if (t.closest('[data-orb-catnewcancel]')) { orbCatClearPickers(); renderOrbPanel(); return; }
        const catNewGo = t.closest('[data-orb-catnewgo]');
        if (catNewGo) {
            const inp = document.querySelector('.ssp-catnewin');
            const want = inp ? String(inp.value || '').trim() : '';
            const at = inp ? (inp.dataset.orbCatnewfor || '') : '';
            const notes = isNotesEl(inp) || isNotesEl(catNewGo);
            if (!want) { toast('给分类起个名字吧', 'warning'); return; }
            const added = notes ? orbNoteCatAdd(want) : orbWbCatAdd(want);
            if (notes) { orbNoteCatSet(at, want); orbNCat = want; }
            else { orbWbCatSet(at, want); orbWbCat = want; }
            orbCatClearPickers();
            toast((added ? '建好了「' : '已有「') + want + '」，已归进去', added ? 'success' : 'info');
            renderOrbPanel();
            return;
        }
        const catDel = t.closest('[data-orb-catdel]');
        if (catDel) {
            const n = catDel.dataset.orbCatdel;
            if (isNotesEl(catDel)) {
                orbNoteCatDel(n);                       // 只清记录上的 cat，番外本身不删
                if (orbNCat === n) orbNCat = ORB_CAT_ALL;
                toast('解散了「' + n + '」（番外本身没删）', 'info');
            } else {
                orbWbCatDel(n);
                if (orbWbCat === n) orbWbCat = ORB_CAT_ALL;
                toast('解散了「' + n + '」（书本身没动）', 'info');
            }
            renderOrbPanel();
            return;
        }
        const catAdd = t.closest('[data-orb-catadd]');
        if (catAdd) {
            const notes = isNotesEl(catAdd);
            orbAskCatName(notes ? '新分类叫什么？（比如：日常 / 灵感 / 设定）' : '新分类叫什么？（比如：世界观 / 人物 / 规则）', '', (n) => {
                const added = notes ? orbNoteCatAdd(n) : orbWbCatAdd(n);
                if (notes) orbNCat = n; else orbWbCat = n;   // 不管新旧都切过去看
                toast(added ? '建好了「' + n + '」' : '切到已有的「' + n + '」', added ? 'success' : 'info');
                renderOrbPanel();
            });
            return;
        }

        /* 世界书页：清除搜索 / 返回当前角色 / 点书名＝加/减这张卡的绑定 /
           自动开关 / 还原这个聊天 / 清空这张卡的绑定 / 换一张角色卡配 */
        if (t.closest('[data-orb-wclear]')) { orbWbSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-wback]')) { orbWbBinding = null; renderOrbPanel(); return; }
        /* 世界书栏：展开某本书里的条目 / 从条目页返回 / 条目增删改 */
        const wOpen = t.closest('[data-orb-wentries]');
        if (wOpen) { orbWbOpenEntries(wOpen.dataset.orbWentries); return; }
        if (t.closest('[data-orb-wback2]')) { orbWbCloseEntries(); renderOrbPanel(); return; }
        if (t.closest('[data-orb-enerefresh]')) { orbWbEntriesFetch(orbWbEntriesBook); return; }
        if (t.closest('[data-orb-eneclear]')) { orbWbEntrySearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-enenew]')) { orbWbEntryOpen = 'new'; orbWbEntryDraft = null; renderOrbPanel(); return; }
        /* ⚠️ 顺序要紧：行本身也是可点的（＝开关），而「✏ 编辑」按钮长在行**里面**，
           所以编辑必须**先判**，否则点 ✏ 会被当成开关。 */
        const enEdit = t.closest('[data-ssp-enedit]');
        if (enEdit) {
            const uid = enEdit.dataset.sspEnedit;
            orbWbEntryOpen = (String(orbWbEntryOpen) === String(uid)) ? null : uid;
            if (String(orbWbEntryOpen) === 'new') orbWbEntryOpen = null;
            orbDlcOpen = (String(orbDlcOpen) === String(uid)) ? null : uid;
            if (String(orbDlcOpen) === 'new') orbDlcOpen = null;
            renderOrbPanel();
            return;
        }
        /* ⚠️ v1.31.59：🎭 那颗也长在行**里面**（行本身＝开关），所以面具的判断同样要先判。
           它同时管三处：行上的 🎭、编辑表单里的面具 chips、挑面具那一页的行。 */
        if (t.closest('[data-orb-enmaskback]')) { orbDlcMaskFor = null; renderOrbPanel(); return; }
        const maskClear = t.closest('[data-orb-enmaskclear]');
        if (maskClear) {
            dlcMaskClear(maskClear.dataset.orbEnmaskclear);
            toast('已清空这一条的面具绑定（改回按你自己的开关）', 'success');
            renderOrbPanel();
            return;
        }
        const maskChip = t.closest('[data-orb-enmaskid]');
        if (maskChip) {
            const uid0 = maskChip.dataset.orbEnmaskchip || maskChip.dataset.orbEnmaskuid || orbDlcMaskFor;
            const pid = maskChip.dataset.orbEnmaskid || '';
            if (uid0 !== null && uid0 !== undefined && String(uid0) !== '' && pid) {
                const nowOn = dlcMaskToggle(uid0, pid);
                const nm = dlcPersonaName(pid);
                toast(nowOn ? ('已绑：戴「' + nm + '」时必须有它') : ('已解绑：' + nm), 'info');
                renderOrbPanel();
            }
            return;
        }
        const maskOpen = t.closest('[data-orb-enmask]');
        if (maskOpen) { orbDlcMaskFor = String(maskOpen.dataset.orbEnmask); renderOrbPanel(); return; }
        const dlcFilterBtn = t.closest('[data-orb-dlcfilter]');
        if (dlcFilterBtn) { orbDlcFilter = dlcFilterBtn.dataset.orbDlcfilter || 'all'; renderOrbPanel(); return; }
        const dlcGlobalBox = t.closest('[data-orb-dlcglobal]');
        if (dlcGlobalBox) {
            const want = Boolean(dlcGlobalBox.checked);
            getSettings().dlcGlobal = want;
            save();
            const r = dlcGlobalApply(want);
            toast(r === true
                ? (want ? '已让「' + orbDlcBook() + '」全局常驻' : '已取消全局常驻')
                : (r === null ? '还没读到酒馆的「世界书」面板 —— 先打开一次它，再回来点这个' : '没能改酒馆那边的勾选'),
                r === true ? 'success' : 'warning');
            if (r === true) renderOrbPanel();
            return;
        }
        /* v1.31.60 查找页：分类筛选 / 思维链开关 / 跳转 / 上一条下一条 / 清除 */
        const findCat = t.closest('[data-orb-findcat]');
        if (findCat) { orbFindCat = findCat.dataset.orbFindcat || 'all'; orbFindCur = -1; orbFindShow = 100; renderOrbPanel(); return; }
        if (t.closest('[data-orb-findsort]')) {
            orbFindSort = (orbFindSort === 'desc') ? 'asc' : 'desc';
            orbFindCur = -1;
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-findmore]')) {
            orbFindShow += 100;
            const box = document.getElementById('ssp_orb_find_body');
            if (box) box.innerHTML = orbFindBodyHTML(); else renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-findthink]')) {
            getSettings().findThink = Boolean(t.checked);
            save();
            orbFindCur = -1;
            if (orbOpenNow && orbTab === 'find') renderOrbPanel();
            return;
        }
        const findRow = t.closest('[data-orb-findrow]');
        if (findRow) {
            const id = findRow.dataset.orbFindrow;
            const list = findRows();
            orbFindCur = list.findIndex(h => String(h.id) === String(id));
            orbFindGo(id);
            return;
        }
        if (t.closest('[data-orb-findprev]')) { orbFindStep(-1); return; }
        if (t.closest('[data-orb-findnext]')) { orbFindStep(1); return; }
        if (t.closest('[data-orb-findclear]')) {
            orbFindQ = ''; orbFindCur = -1;
            renderOrbPanel();
            return;
        }
        /* ⚠️ 删除的判断必须排在「点整行＝开关」**前面**：
           🗑 和确认按钮都长在那一行**里面**，而行本身有 data-ssp-entoggle，
           先判 enToggle 就会把点 🗑 当成"开关这一条" —— 表现就是"点删除没反应、删不掉"
           （用户反馈"创建了一大堆删不掉"，实测确认就是这个顺序问题）。 */
        const enDel = t.closest('[data-ssp-endel]');
        if (enDel) {
            /* 删除确认**做在面板里**（就地展开一行确认），不走酒馆的 callGenericPopup。
               ⚠️ 原因：实测这个构建的 `callGenericPopup(CONFIRM)` 会把弹窗节点建出来，
               但 `#shadow_popup` 停在 `display:none` —— 弹窗压根看不见，于是"点了没反应、删不掉"
               （用户反馈'创建了一大堆删不掉'）。就地确认还顺带在手机上更好点。
               真正执行删除的是下面 [data-ssp-endelete]。 */
            const uid = enDel.dataset.sspEndel;
            /* ⚠️ 别写成 `(String(orbDelConfirm) === String(uid)) ? null : uid`：
               uid 可能是 **0**，而 orbDelConfirm 为空时 String(null) === 'null' 不会相等，
               但 uid='0' 时 String(0)==='0' 也不相等 —— 真正踩到的是 uid=0 那条被当成"已选过"，
               于是第一次点就翻成 null，表现就是"点了没反应"（实测抓到）。显式判空最稳。 */
            orbDelConfirm = (orbDelConfirm !== null && String(orbDelConfirm) === String(uid)) ? null : String(uid);
            renderOrbPanel();
            return;
        }
        const enDelGo = t.closest('[data-ssp-endelete]');
        if (enDelGo) {
            const uid = parseInt(enDelGo.dataset.sspEndelete, 10);
            const book = enDelGo.dataset.sspBook || '';
            const list = (orbTab === 'dlc') ? orbDlcEntries : orbWbEntries;
            const hit = list.find(x => String(x.uid) === String(uid));
            const nm = (hit && hit.comment) || ('条目 ' + uid);
            orbDelConfirm = null;
            orbEntryDel(book, uid).then(ok => {
                if (!ok) { renderOrbPanel(); toast('没删掉，可能酒馆那边没写成功', 'warning'); return; }
                toast('已删掉：' + nm, 'success');
                if (orbTab === 'dlc') orbDlcFetch(); else orbWbEntriesFetch(book);
            });
            return;
        }
        if (t.closest('[data-ssp-endelcancel]')) { orbDelConfirm = null; renderOrbPanel(); return; }
        const enToggle = t.closest('[data-ssp-entoggle]');
        if (enToggle) {
            const uid = parseInt(enToggle.dataset.sspEntoggle, 10);
            const book = enToggle.dataset.sspBook || (orbTab === 'dlc' ? orbDlcBook() : orbWbEntriesBook);
            const dlc = (orbTab === 'dlc');
            /* v1.31.59：绑了面具的条目，点整行 = **临时关**（只在内存里，不写书、不解除绑定），
               换面具 / 换聊天 / 刷新就恢复"面具要求开" —— 用户选的"当成临时关"。
               没戴面具时（宽松）它跟普通条目没区别 → 照旧写书切换。 */
            if (dlc && dlcEntryMasks(uid).length) {
                const hit0 = (orbDlcEntries || []).find(x => String(x.uid) === String(uid)) || { uid: uid };
                const st = dlcEntryState(hit0);
                const nm = (hit0 && hit0.comment) || ('条目 ' + uid);
                if (st.mode === 'other-mask') {
                    toast('这条绑给别的面具了（' + dlcMaskNames(uid) + '）—— 戴上它才会开；想改就点 🎭', 'info');
                    return;
                }
                if (st.mode !== 'no-mask') {
                    const k = String(uid);
                    if (dlcTempOff.has(k)) dlcTempOff.delete(k); else dlcTempOff.add(k);
                    toast((dlcTempOff.has(k) ? '这次先关掉' : '又打开') + '：' + nm
                        + '（换面具 / 刷新就恢复「面具要求开」）', 'info');
                    renderOrbPanel();
                    return;
                }
            }
            orbEntryToggle(book, uid).then(on => {
                if (on === null) return;
                const list = dlc ? orbDlcEntries : orbWbEntries;
                const hit = list.find(x => String(x.uid) === String(uid));
                if (hit) hit.disable = !on;
                toast((on ? '已打开' : '已关闭') + '：' + ((hit && hit.comment) || ('条目 ' + uid)), 'info');
                if (orbOpenNow) renderOrbPanel();
            });
            return;
        }
        const enSave = t.closest('[data-ssp-ensave]');
        if (enSave) {
            const book = enSave.dataset.sspBook || '';
            const raw = enSave.dataset.sspEnsave;
            const isNew = (raw === '' || raw === 'undefined' || raw === 'null');
            const uid = isNew ? null : parseInt(raw, 10);
            const host = document.querySelector('[data-ssp-enform]');
            const val = (f) => {
                const el = host && host.querySelector('[data-ssp-enf="' + f + '"]');
                if (!el) return undefined;
                return (el.type === 'checkbox') ? Boolean(el.checked) : el.value;
            };
            const constant = val('constant');
            const patch = {
                comment: String(val('comment') || '').trim(),
                content: String(val('content') || ''),
                constant: constant !== false,
                key: constant === false ? String(val('key') || '') : '',
                order: val('order'), depth: val('depth'), probability: val('probability'),
            };
            if (!patch.comment) { toast('给这条起个标题吧', 'warning'); return; }
            const done = (isNew)
                ? orbEntryAdd(book, patch).then(e => { orbWbEntryOpen = null; orbDlcOpen = null; return e; })
                : orbEntrySave(book, uid, patch).then(ok => { if (ok) { orbWbEntryOpen = null; orbDlcOpen = null; } return ok; });
            done.then(() => {
                toast(isNew ? '条目已创建' : '条目已保存', 'success');
                if (orbTab === 'dlc') orbDlcFetch(); else orbWbEntriesFetch(book);
            });
            return;
        }
        if (t.closest('[data-ssp-encancel]')) {
            orbWbEntryOpen = null; orbDlcOpen = null; orbWbEntryDraft = null; orbDlcDraft = null;
            renderOrbPanel();
            return;
        }
        /* DLC 栏：新建 / 刷新 / 清除搜索 / 默认状态开关 */
        if (t.closest('[data-orb-dlcnew]')) { orbDlcOpen = 'new'; orbDlcDraft = null; renderOrbPanel(); return; }
        if (t.closest('[data-orb-dlcrefresh]')) { orbDlcFetch(); return; }
        /* 一键清空（走就地确认；删之前把每条的 uid 都过一遍，避免并发写丢） */
        if (t.closest('[data-orb-dlcpurge]')) { orbPurgeConfirm = true; renderOrbPanel(); return; }
        if (t.closest('[data-orb-dlcpurgecancel]')) { orbPurgeConfirm = false; renderOrbPanel(); return; }
        if (t.closest('[data-orb-dlcpurgego]')) {
            const book = orbDlcBook();
            const uids = (orbDlcEntries || []).map(e => e.uid);
            orbPurgeConfirm = false;
            renderOrbPanel();
            orbEntryDelMany(book, uids).then(n => {
                toast(n ? ('清空了 ' + n + ' 条') : '没删掉，可能酒馆那边没写成功', n ? 'success' : 'warning');
                orbDlcFetch();
            });
            return;
        }
        if (t.closest('[data-orb-dlcseed]')) { orbDlcAddSeed().then(() => orbDlcFetch()); return; }
        if (t.closest('[data-orb-dlcclear]')) { orbDlcSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-dlcconst]')) {
            getSettings().dlcConstant = Boolean(t.checked);
            save();
            toast(t.checked ? '新建条目默认：🔵 常驻' : '新建条目默认：🟢 关键词触发', 'info');
            return;
        }
        if (t.closest('[data-orb-wrestore]')) { orbWbRestoreCur(); renderOrbPanel(); return; }
        if (t.closest('[data-orb-wauto]')) {
            getSettings().worldAuto = Boolean(t.checked);
            save();
            toast(t.checked ? '切角色自动启用世界书：开' : '切角色自动启用世界书：关', 'info');
            return;
        }
        const wClearAll = t.closest('[data-orb-wclearall]');
        if (wClearAll) {
            const ch0 = orbWbTargetChar();
            if (!ch0) { toast('先在酒馆里打开一个聊天', 'warning'); return; }
            const had = orbWbBound(ch0.key);
            if (!had.length) { toast('这张卡本来就没绑世界书', 'info'); return; }
            getContext().callGenericPopup('清空「' + ch0.name + '」绑定的全部 ' + had.length + ' 本世界书？<br>'
                + '<i style="opacity:.6">（只清绑定关系，不会删世界书文件）</i>',
                getContext().POPUP_TYPE.CONFIRM, '', { okButton: '清空', cancelButton: '算了' })
                .then(r => {
                    if (r !== getContext().POPUP_RESULT.AFFIRMATIVE) return;
                    /* 先把它加进去的还回去，再清绑定，顺序反了会留下我们加的书 */
                    if (orbWbChatKey() && orbWbRecord(orbWbChatKey())) orbWbCleanup(orbWbChatKey());
                    orbWbSetBound(ch0.key, []);
                    toast('已清空「' + ch0.name + '」的世界书绑定', 'success');
                    if (orbOpenNow) renderOrbPanel();
                });
            return;
        }
        const wToggle = t.closest('[data-orb-wtoggle]');
        if (wToggle) {
            /* ⚠️ 行里那个「📖 展开条目」按钮长在这一行**里面**，而这一行本身也可点（绑定）。
               处理器里 📖 的判断（wOpen）在更前面，所以点 📖 时根本走不到这里；
               这里再兜一层：万一命中，也只处理 📖、不当成点行。 */
            if (t.closest('[data-orb-wentries]')) { renderOrbPanel(); return; }
            /* 点书名＝改这张角色卡的绑定。干净版：改完让本聊天的生效列表**对齐这张卡**
               （绑上就启用、解绑就撤掉），一一对应，不留跟这张卡无关的书。 */
            const name = wToggle.dataset.orbWtoggle;
            const ch = orbWbTargetChar();
            if (!ch) { toast('先在酒馆里打开一个聊天，才能给角色卡配绑定', 'warning'); return; }
            const wasBound = orbWbBound(ch.key).indexOf(name) >= 0;
            orbWbToggleBound(ch.key, name);
            if (wasBound) {
                toast('已解绑并从本聊天撤掉：' + name, 'info');
            } else {
                toast('已绑定并在本聊天启用：' + name, 'success');
            }
            orbWbSyncChar();     // 让生效列表跟这张卡的绑定对齐
            renderOrbPanel();
            return;
        }
        const wChar = t.closest('[data-orb-wchar]');
        if (wChar && wChar.tagName === 'SELECT') { /* 下面 change 事件里处理 */ return; }
        /* 模块标签页 */
        /* v1.31.63 页签收纳：「…」开合 / 弹层里切页签 / 整理（收起来·放回去） */
        if (t.closest('[data-orb-tabmore]')) {
            orbTabMenu = !orbTabMenu;
            if (!orbTabMenu) orbTabMenuEdit = false;
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-tabmenuclose]')) {
            orbTabMenu = false; orbTabMenuEdit = false;
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-tabmenuedit]')) {
            orbTabMenuEdit = !orbTabMenuEdit;
            renderOrbPanel();
            return;
        }
        const tabOpen = t.closest('[data-orb-tabopen]');
        if (tabOpen) {
            const nextTab = tabOpen.dataset.orbTabopen || 'pick';
            if (orbTab === 'editor' && nextTab !== 'editor') { try { orbEditorUnmount(); } catch (e) { } }
            orbTab = nextTab; orbEditing = null;
            orbTabMenu = false; orbTabMenuEdit = false;
            renderOrbPanel();
            if (orbTab === 'editor') { setTimeout(() => { try { orbEditorMountSoon(28); } catch (e) { } }, 40); }
            if (orbTab === 'chat') orbChatsFetch();
            if (orbTab === 'bg') { try { orbBgSyncChar(true); } catch (e) { } orbBgFetch(); }
            if (orbTab === 'world') orbWorldRefresh();
            if (orbTab === 'dlc') orbDlcEnsure();
            return;
        }
        const tabHide = t.closest('[data-orb-tabhide]');
        if (tabHide) {
            const id = tabHide.dataset.orbTabhide;
            const now = orbTabHideSet(id, !orbTabIsHidden(id));
            /* 收起来以后当前页签可能刚好被收进去 → 让「…」高亮，面板内容不用动 */
            renderOrbPanel();
            toast(now ? ('已把「' + ((orbModule(id) || {}).name || id) + '」收进「…」')
                : ('已把「' + ((orbModule(id) || {}).name || id) + '」放回页签栏'), 'info');
            return;
        }
        const tabEl = t.closest('[data-orb-tab]');
        if (tabEl) {
            const nextTab = tabEl.dataset.orbTab || 'notes';
            /* 离开「写卡」时先把写卡块还家，再重画（不然它会被 innerHTML 一起清掉 → 酒馆就再也找不到它了） */
            if (orbTab === 'editor' && nextTab !== 'editor') { try { orbEditorUnmount(); } catch (e) { } }
            orbTab = nextTab; orbEditing = null;
            orbWbBinding = null;
            orbTabMenu = false; orbTabMenuEdit = false;    // 切页签就收起「…」
            personaChatMaskKey = '';                       // 离开存档页就把"挑面具"那一页收掉
            orbWbCloseEntries(true);
            renderOrbPanel();
            /* 回到「写卡」页签：把块再搬进来 */
            if (orbTab === 'editor') { setTimeout(() => { try { orbEditorMountSoon(28); } catch (e) { } }, 40); }            if (orbTab === 'chat') orbChatsFetch();            // 存档页：打开就拉一次列表
            if (orbTab === 'bg') { try { orbBgSyncChar(true); } catch (e) { } orbBgFetch(); } // 背景页：打开就对齐 + 拉列表
            if (orbTab === 'world') orbWorldRefresh();         // 世界书页：顺手刷一次清单
            if (orbTab === 'dlc') orbDlcEnsure();              // DLC 页：按需拉那本书的条目
            return;
        }
        /* 数据页：一键导出全量备份（只读，不写库里任何东西） */
        if (t.closest('[data-orb-dataexport]')) { orbDataExport(); return; }
        /* 数据页：选备份包 / 开始恢复 */
        if (t.closest('[data-orb-dataimportpick]')) {
            const inp = sspTabRoot().querySelector('#ssp_orb_panel [data-orb-dataimportfile]');
            if (inp) inp.click(); else toast('找不到文件选择框，刷新一下页面', 'warning');
            return;
        }
        if (t.closest('[data-orb-datarestore]')) { orbImpRestore(); return; }
        /* 番外页：清除搜索 */
        if (t.closest('[data-orb-nclear]')) { orbNSearch = ''; renderOrbPanel(); return; }
        /* 魔法棒：收纳 / 展开悬浮球 */
        if (t.closest('[data-orb-wand]')) { orbSetCollapsed(!orbCollapsed); return; }
        /* 背景页：换一张 / 绑给本卡 / 解绑 / 上传 / 刷新 / 改名 / 删除 / 搜索 / 自动开关 */
        if (t.closest('[data-orb-bgclear]')) { orbBgSearch = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-bgrefresh]')) { orbBgFetch(); return; }
        if (t.closest('[data-orb-bgupload]')) { const f = document.querySelector('[data-orb-bgfile]'); if (f) f.click(); return; }
        if (t.closest('[data-orb-bgfile]')) return;   // 交给下面 input 的 change
        if (t.closest('[data-orb-bguser]')) {
            const now = orbBgNow();
            if (!now) { toast('现在没有生效的背景图', 'warning'); return; }
            orbBgUserSet(now, true);
            toast('已记下你自己的背景：' + now, 'success');
            renderOrbPanel(); return;
        }
        if (t.closest('[data-orb-bgunbind]')) { orbBgSetBind(''); renderOrbPanel(); return; }
        if (t.closest('[data-orb-bgdelcancel]')) { orbBgDel = null; renderOrbPanel(); return; }
        const bgDelGo = t.closest('[data-orb-bgdelgo]');
        if (bgDelGo) { const nm = bgDelGo.dataset.orbBgdelgo; orbBgDel = null; orbBgDelete(nm).then(() => renderOrbPanel()); return; }
        const bgDel = t.closest('[data-orb-bgdel]');
        if (bgDel) {
            const nm = bgDel.dataset.orbBgdel;
            orbBgDel = (orbBgDel !== null && String(orbBgDel) === String(nm)) ? null : String(nm);
            renderOrbPanel(); return;
        }
        const bgRen = t.closest('[data-orb-bgren]');
        if (bgRen) {
            const nm = bgRen.dataset.orbBgren;
            orbAskText('把背景图「' + nm + '」改成什么名字？<br><i style="opacity:.6">酒馆会自动清洗文件名里的非法字符</i>', nm).then(v => {
                if (!v || String(v).trim() === nm) return;
                orbBgRenameTo(nm, String(v).trim()).then(() => renderOrbPanel());
            });
            return;
        }
        const bgBind = t.closest('[data-orb-bgbind]');
        if (bgBind) { orbBgSetBind(bgBind.dataset.orbBgbind); renderOrbPanel(); return; }
        const bgOne = t.closest('[data-orb-bg]');
        if (bgOne) {
            const nm = bgOne.dataset.orbBg;
            /* 手动换背景：如果我们正覆盖着，撤销记账，免得切角色时又给"恢复"回去 */
            try { const key = orbBgChatKey(); if (key && orbBgApplied()[key]) { delete orbBgApplied()[key]; save(); } } catch (e) { }
            orbBgApply(nm);
            renderOrbPanel(); return;
        }
        /* 美化页：常用开关的展开栏标题（点一下展开/收起） */
        if (t.closest('[data-orb-btopen]')) { orbBeautyOpen = !orbBeautyOpen; renderOrbPanel(); return; }
        /* 美化页：常用开关（点开关/整行都算，toggle） */
        const bt = t.closest('[data-orb-btweak]');
        if (bt) {
            const id = bt.dataset.orbBtweak;
            orbBeautySet(id, !orbBeautyOn(id));
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-btreset]')) { orbBeautyReset(); renderOrbPanel(); return; }
        if (t.closest('[data-orb-btreload]')) { orbBeautyApply(); toast('已重新注入常用开关样式', 'info'); return; }
        /* 美化页：面板配色（自动 / 跟随 / 深色 / 浅色）＋ 重测 */
        const skinBtn = t.closest('[data-orb-skin]');
        if (skinBtn) {
            sspSkinSet(skinBtn.dataset.orbSkin);
            renderOrbPanel();
            toast('面板配色：' + (SSP_SKIN_MODES.find(x => x[0] === sspSkinMode()) || ['', '自动'])[1]
                + (sspSkinNow === 'follow' ? '（跟随美化）' : '（已锁深色）'), 'success');
            return;
        }
        if (t.closest('[data-orb-skinretest]')) {
            sspSkinProbeLast = null;
            const d = sspSkinApply(true);
            renderOrbPanel();
            toast(d.why, d.skin === 'follow' ? 'info' : 'warning');
            return;
        }
        /* 美化页：看得清吗（体检 / 重新体检 / 找元凶 / 修一下 / 写回主题） */
        if (t.closest('[data-orb-ctopen]')) {
            orbCtOpen = !orbCtOpen;
            if (orbCtOpen && orbCtRows === null) { try { sspContrastRun(); } catch (e) { } }
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-ctcheck]')) {
            let rows = [];
            try { rows = sspContrastRun(); } catch (e) { rows = []; }
            const bad = rows.filter(sspCtBad).length;
            renderOrbPanel();
            toast(bad ? ('体检完：' + bad + ' 处看不清') : '体检完：都看得清', bad ? 'warning' : 'success');
            return;
        }
        if (t.closest('[data-orb-ctblame]')) {
            let n = 0;
            try { n = sspContrastBlame(); } catch (e) { n = 0; }
            renderOrbPanel();
            toast(n ? ('找到 ' + n + ' 处的元凶（看行尾那个变量名）') : '这几处定位不到是哪条变量在管（多半写死在具体选择器上了）',
                n ? 'success' : 'info');
            return;
        }
        const ctFix = t.closest('[data-orb-ctfix]');
        if (ctFix) {
            const idx = Number(ctFix.dataset.orbCtfix);
            const row = (orbCtRows || [])[idx];
            const el = orbCtEls[idx];
            if (!row || !el) { toast('这一处现在量不到了（聊天可能关了），刷新后再试', 'warning'); return; }
            /* v1.31.80：先治"字太小"（字号小到看不清时，对比度再高也没用） */
            const 目标字号 = Math.max(SSP_CT_MIN_PX + 2, 13);
            if (row.太小) {
                const fh = (row.字号元凶 || [])[0];
                if (fh) {
                    const ov = themeVarsOf();
                    ov[fh.k] = 目标字号 + 'px';
                    try { themeVarsApply(); } catch (e) { }
                    save();
                    orbCtRows = null;
                    renderOrbPanel();
                    toast('已把 ' + fh.k + ' 调成 ' + 目标字号 + 'px（覆盖层）；满意再点「写回主题」', 'success');
                    return;
                }
                const fb = sspCtFallback(row.选择器, { fontSize: 目标字号 + 'px' }, el);
                orbCtRows = null;
                renderOrbPanel();
                toast('这一处的字号定位不到变量，已只给它自己写了一条 ' + 目标字号 + 'px'
                    + (fb && fb.用来行内 ? '（走行内 !important）' : ''), 'info');
                return;
            }
            if (row.太挤) {
                const fb = sspCtFallback(row.选择器, { lineHeight: '1.5' }, el);
                orbCtRows = null;
                renderOrbPanel();
                toast('这一处行高太挤，已给它自己写成 1.5 倍行距'
                    + (fb && fb.用来行内 ? '（走行内 !important）' : ''), 'info');
                return;
            }
            if (!row.元凶 || !row.元凶.length) {
                /* 没元凶：只改这一处的颜色（兜底样式），并且把标签说清楚 */
                const bg = sspParseColor(row.背景) || { r: 12, g: 12, b: 14, a: 1 };
                const fg = sspParseColor(getComputedStyle(el).color) || { r: 200, g: 200, b: 200, a: 1 };
                const r = sspFixColorToContrast(fg, bg, 4.5);
                const fb = sspCtFallback(row.选择器, r.color, el);
                orbCtRows = null;
                renderOrbPanel();
                toast('这一处定位不到变量，已只给它自己写了一条兜底色 ' + r.color
                    + (fb && fb.用来行内 ? '（美化的规则更硬，用了行内 !important）' : '')
                    + '：' + r.cr.toFixed(2) + ':1', 'info');
                return;
            }
            const h = row.元凶[0];
            const bg = sspParseColor(row.背景) || { r: 12, g: 12, b: 14, a: 1 };
            let fg = null;
            try { fg = sspParseColor(getComputedStyle(el).color); } catch (e) { fg = null; }
            if (!fg) fg = sspParseColor(row.前景);
            const r = sspFixColorToContrast(fg, bg, 4.5);
            if (!r || !r.改了吗) { toast('这条颜色已经够清楚了（' + (r ? r.cr.toFixed(2) : '?') + ':1）', 'info'); return; }
            const ov = themeVarsOf();
            ov[h.k] = r.color;
            try { themeVarsApply(); } catch (e) { }
            save();
            orbCtRows = null;
            renderOrbPanel();
            toast('已把 ' + h.k + ' 调成 ' + r.color + '（覆盖层，' + r.cr.toFixed(2) + ':1）；满意再点「写回主题」', 'success');
            return;
        }
        if (t.closest('[data-orb-ctwrite]')) {
            if (!themeVarsWriteBack()) return;
            orbCtRows = null;
            renderOrbPanel();
            return;
        }
        /* 存档页：刷新 / 读档 / 删除 / 清除搜索 */
        if (t.closest('[data-orb-chrefresh]')) { orbChatsFetch(); return; }        if (t.closest('[data-orb-chclear]')) { orbChSearch = ''; renderOrbPanel(); return; }
        /* v1.31.64：存档页 🎭 —— 给这份存档挑面具（整页替换） */
        const chatMask = t.closest('[data-orb-chatmask]');
        if (chatMask) {
            personaChatMaskKey = chatMask.dataset.orbChatmask || '';
            if (!orbChatList.length) { orbChatsFetch().then(() => { if (orbOpenNow) renderOrbPanel(); }); }
            renderOrbPanel();
            return;
        }
        if (t.closest('[data-orb-chatmaskback]')) { personaChatMaskKey = ''; renderOrbPanel(); return; }
        if (t.closest('[data-orb-chatmaskclear]')) {
            personaChatBindSet(personaChatMaskKey, '');
            toast('已清空这份存档的面具绑定', 'success');
            renderOrbPanel();
            return;
        }
        const chatMaskId = t.closest('[data-orb-chatmaskid]');
        if (chatMaskId) {
            const pid = chatMaskId.dataset.orbChatmaskid || '';
            const key = personaChatMaskKey;
            if (key && pid) {
                const was = personaChatBindOf(key);
                personaChatBindSet(key, was === pid ? '' : pid);
                toast(was === pid ? ('已解绑：' + dlcPersonaName(pid))
                    : ('这份存档锁着：' + dlcPersonaName(pid) + '（切过去自动戴）'), 'success');
                /* 就是当前这份存档 → 立刻应用一次，别等下次切换 */
                if (key === personaChatKeyCur()) { personaChatApply(true); }
                renderOrbPanel();
            }
            return;
        }
        /* v1.31.64：面具页「绑定」弹层里的分组切换（角色卡 / 存档）+ 点存档绑 */
        const bindTab = t.closest('[data-orb-bindtab]');
        if (bindTab) {
            personaBindTab = bindTab.dataset.orbBindtab === 'chat' ? 'chat' : 'char';
            if (personaBindTab === 'chat' && !orbChatList.length && !orbChatLoading) {
                orbChatsFetch().then(() => { if (orbOpenNow) renderOrbPanel(); });
            }
            renderOrbPanel();
            return;
        }
        const bindChat = t.closest('[data-orb-bindchat]');
        if (bindChat) {
            const key = bindChat.dataset.orbBindchat || '';
            const pid = orbBinding || '';
            if (key && pid) {
                const mine = personaChatBindOf(key) === pid;
                personaChatBindSet(key, mine ? '' : pid);
                toast(mine ? '已解绑这份存档' : ('已绑：这份存档用「' + dlcPersonaName(pid) + '」'), 'info');
                if (!mine && key === personaChatKeyCur()) { personaChatApply(true); }
                renderOrbPanel();
            }
            return;
        }
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
        /* 面具栏：编辑 / 选一个 / 新建 / 绑定 / 删 */
        if (t.closest('[data-orb-pdelcancel]')) { orbPersonaDel = null; renderOrbPanel(); return; }
        const pdelgo = t.closest('[data-orb-pdelgo]');
        if (pdelgo) {
            const pid = pdelgo.dataset.orbPdelgo;
            orbPersonaDel = null;
            orbPersonaDelete(pid).then(() => { if (orbOpenNow) renderOrbPanel(); });
            return;
        }
        const pdel = t.closest('[data-orb-pdel]');
        if (pdel) {
            const pid = pdel.dataset.orbPdel;
            /* ⚠️ 别写成 (String(orbPersonaDel) === pid) ? null : pid —— 空的时候 String(null)==='null' 不等，
               但 id 有可能就是 'null' 这种怪值；这里只用显式 null 判断。 */
            orbPersonaDel = (orbPersonaDel !== null && String(orbPersonaDel) === String(pid)) ? null : String(pid);
            renderOrbPanel();
            return;
        }
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
        if (bindBtn) {
            orbBinding = bindBtn.dataset.orbBind;
            personaBindTab = 'char';                    // 每次打开都从「角色卡」开始（存档那栏要现拉列表）
            renderOrbPanel();
            return;
        }
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

    /* 口袋开着时点**酒馆原生**的「新建角色」：也走"口袋写卡"这条路。
       ⚠️ 为什么必须单独接一下：原生流程只把表单设成 createcharacter 并把块留在右侧面板
          （`select_rm_create` 不显示写卡块），不经过我们的页签；
          而工坊可能把那颗按钮搬到别处，所以用**捕获阶段 + id 判定**，不依赖选择器位置。 */
    if (!bindOrb.nativeCreateBound) {
        bindOrb.nativeCreateBound = true;
        document.addEventListener('click', ev => {
            const t = (ev.composedPath && ev.composedPath()[0]) || ev.target;
            if (!t || !t.closest) return;
            if (!t.closest('#rm_button_create')) return;
            if (!orbOpenNow) return;                  // 口袋没开就别抢，让酒馆自己走
            try {
                globalThis.setTimeout(() => { try { orbEditorOpen(); } catch (e) { } }, 300);
                orbEditorMountSoon(28);
            } catch (e) { }
        }, true);
    }

    /* ⚠️ 窗口大小变化时，按「离边距离」重算位置 ——
       这就是用户要的"窗口缩小，球跟着贴边走"。以前存绝对像素，一缩窗口球就脱边/跑出屏幕。 */
    if (!bindOrb.resizeBound) {
        bindOrb.resizeBound = true;
        window.addEventListener('resize', () => {
            orbPlaceBall();      // 内部会先 orbClampEdge() 再摆位
            /* 魔法棒也跟着重算（它同样是 fixed + JS 定位） */
            const wd = document.getElementById('ssp_orb_wand');
            if (wd) {
                wd.style.left = '14px';
                wd.style.top = Math.round(window.innerHeight - (wd.offsetHeight || 34) - 14) + 'px';
                wd.style.right = 'auto'; wd.style.bottom = 'auto';
            }
        });
    }
    return true;
}


function init() {
    const ctx = getContext();
    if (!ctx) { warn('拿不到 getContext()，扩展不启动'); return false; }
    sspHookErrors();          // 先挂错误收集，后面任何一步出错都能被「完整性检查」抓到
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
    if (getSettings().orbOn !== false) { mountOrb(); bindOrb(); }
    /* v1.31.59：DLC 条目 ↔ 面具的过滤监听**无条件**挂一次（球关掉也要生效 —— 它管的是生成，
       跟界面无关）。拿不到上下文时它自己会在后面重试。 */
    bindDlcMaskWatch();
    /* 测试环境：给旧测试补一个"能查到影子根里元素"的兼容层（生产环境不生效） */
    try { sspInstallTestQueryShim(); } catch (e) { }
    /* v1.31.64：已经打开的这份存档如果绑了面具，启动后也补一次（不然要等你切一次存档才生效） */
    globalThis.setTimeout?.(() => { try { personaChatApply(true); } catch (e) { } }, 2200);
    qbMount(); bindOrb && qbBind();      // 快捷按钮托盘：建 + 绑事件（幂等）
    /* 面板一挂上就绑事件委托（含选卡页的分组框、开场白列表），别等到进写卡页才绑 */
    try {
        let bt = 0;
        const bindLater = () => {
            if (chBindNativeOnce()) return;
            if (bt++ > 20) return;
            globalThis.setTimeout?.(bindLater, 300);
        };
        bindLater();
    } catch (e) { }
    bindHdAvatars();
    bindPocketMenuEntry();                                            // 「鼠鼠口袋」入口挂进扩展程序展开栏

    try {
        ctx.eventSource?.on?.(ctx.eventTypes?.CHARACTER_PAGE_LOADED, () => { reclaim('page-loaded'); try { orbOnCharChanged(); } catch (e) { } });
        ctx.eventSource?.on?.(ctx.eventTypes?.CHARACTER_EDITOR_OPENED, () => reclaim('editor-opened'));
        ctx.eventSource?.on?.(ctx.eventTypes?.CHAT_CHANGED, () => { reclaim('chat-changed'); try { orbOnCharChanged(); } catch (e) { } });
        ctx.eventSource?.on?.(ctx.eventTypes?.APP_READY, () => { ensureMount(); mountDrawer(); reclaim('app-ready'); try { orbOnCharChanged(); } catch (e) { } });
    } catch (e) { warn('事件挂载失败', e); }

    /* ⚠️ 这里以前写死了 v0.3.0 —— 面板显示 1.31.x、控制台却喊 0.3.0，对不上。
       版本号只有两处真源：PANEL_VERSION 和 manifest.json，日志跟着 PANEL_VERSION 走。 */
    log('v' + PANEL_VERSION + ' 已加载（' + activeDevice() + '）');
    return true;
}

const started = init();

/* 离线测试钩子 —— 生产环境不生效 */
if (globalThis.__SSP_TEST__) {
    globalThis.__SSP_TEST_API = {
        MODULE_NAME, BUTTONS, ZONES, ZONE_IDS, MOUNT_ID, BOX_ID, TOGGLE_ID, ZONE_PREFIX, ALIGNS, ALIGN_CSS, SCHEMA_VERSION,
        defaultLayout, getSettings, apply, restoreAll, reclaim, save,
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
        importSnapshotExtras, importRestoreExtras, importDiffHTML,
        ORB_DATA_CATS, orbDataPickOf, orbDataPicked, orbDataHTML, orbDataBuild, orbDataExport,
        orbDataSafe, orbDataFmtSize, orbDataReadme, orbDataArr, orbDataNameOf, orbDataZipCtor, orbDataPick,
        orbDataPost, orbDataBlob, getSettings,
        orbPersonaCreate, orbPersonaNew, orbPersonas, orbPlaceholderBlob, orbPersonaDesc,
        orbPersonaDelete, orbActivePersona,
        orbBgList, orbBgBound, orbBgSetBind, orbBgSyncChar, orbBgApply, orbBgNow, orbBgUser, orbBgUserSet, orbBgUrl,
        orbBgFetch, orbBgHTML, orbBgRowsHTML, orbBgDelete, orbBgRenameTo,
        get orbBgSearch() { return orbBgSearch; }, set orbBgSearch(v) { orbBgSearch = v; },
        get orbBgDel() { return orbBgDel; }, set orbBgDel(v) { orbBgDel = v; },
        orbDbgOpenWin, orbDbgClose, orbDbgRun, orbDbgFmt, orbDbgSay, orbDbgText, orbDbgClear,
        orbDbgDiagScreen, orbDbgDiagMedia, orbDbgDiagCss, orbDbgDiagState, orbDbgDiag,
        orbDbgSelectorOf, orbDbgInspect, orbDbgPickStart, orbDbgPickOff, orbDbgStore,
        orbDbgEl, orbDbgSaveScript, orbDbgListScripts,
        ORB_BEAUTY_TWEAKS, orbBeautyState, orbBeautyOn, orbBeautyApply, orbBeautySet, orbBeautyReset, orbBeautyHTML,
        sspSkinApply, sspSkinSet, sspSkinMode, sspSkinProbe, sspSkinHTML, sspContrast, sspParseColor, sspEffBg, sspEffBgEx,
        sspMixColor, sspLum, SSP_SKIN_VARS, SSP_SKIN_SEL, SSP_SKIN_MODES,
        get sspSkinProbeLast() { return sspSkinProbeLast; },
        get sspSkinNow() { return sspSkinNow; },
        /* v1.31.78：对比度体检 */
        SSP_CT_POINTS, SSP_CT_MIN_PX, sspContrastRun, sspBlameVar, sspBlameConfirm, sspContrastBlame,
        sspFixColorToContrast, sspCssRules, sspSplitDecls, sspSpec, sspToHsl, sspFromHsl,
        sspRgbToHex, sspCtFallback, sspCtFallbackClear, sspCtBad, orbContrastHTML, themeVarsOf, themeVarsApply,
        /* v1.31.79：中文化 */
        SSP_VAR_DICT, SSP_TV_CATS, sspVarCat, sspVarCatTag, sspNameTokens, sspVarNameCN, sspGroupNameCN, sspVarAliasOf, sspVarAliasSet,
        sspVarDictJSON, sspVarDictLoad, sspDictUser, sspDictOf, themeVarsParse, orbThemeCss,
        get orbTVSearch() { return orbTVSearch; },
        set orbTVSearch(v) { orbTVSearch = String(v == null ? '' : v); },
        get orbTVCat() { return orbTVCat; }, set orbTVCat(v) { orbTVCat = String(v || 'all'); },
        get orbTVDictOpen() { return orbTVDictOpen; },
        set orbTVDictOpen(v) { orbTVDictOpen = v; },
        get orbCtRows() { return orbCtRows; },
        set orbCtRows(v) { orbCtRows = v; },
        get orbCtEls() { return orbCtEls; },
        get orbCtOpen() { return orbCtOpen; },
        set orbCtOpen(v) { orbCtOpen = v; },
        orbSeamFillOff, orbSeamFillUpdate, orbSeamFillSync,
        get orbBeautyOpen() { return orbBeautyOpen; }, set orbBeautyOpen(v) { orbBeautyOpen = v; },
        orbDbgRule, orbDbgDivider, orbDbgHl, orbDbgHlShow, orbDbgHlHide, orbDbgTagOf, orbDbgUnder,
        orbDbgPickMove, orbDbgPickTip,
        get orbDbgSeq() { return orbDbgSeq; }, set orbDbgSeq(v) { orbDbgSeq = v; },
        get orbDbgPendEl() { return orbDbgPendEl; }, set orbDbgPendEl(v) { orbDbgPendEl = v; },
        get orbDbgPick() { return orbDbgPick; }, set orbDbgPick(v) { orbDbgPick = v; },
        get orbDbgOpen() { return orbDbgOpen; }, set orbDbgOpen(v) { orbDbgOpen = v; },
        get orbDbgCode() { return orbDbgCode; }, set orbDbgCode(v) { orbDbgCode = v; },
        get orbDbgOut() { return orbDbgOut; }, set orbDbgOut(v) { orbDbgOut = v; },
        get orbPersonaDel() { return orbPersonaDel; }, set orbPersonaDel(v) { orbPersonaDel = v; },
        ORB_IMP_CATS, orbImpHTML, orbImpRead, orbImpRestore, orbImpAvatarOf, orbImpPick,
        extractThinking, applyThinkingShield, thinkTags, registerThinkDisplayHook, registerThinkEvents,
        migrateTweaksSettings, TWEAKS_MODULE_NAME,
        restoreCardStyle, hdCardAvatars, cardDrawerHTML, mountDrawer, attrOf, setAttr,
        mountOrb, bindOrb, openOrb, closeOrb, lockOrbSkin, orbClampEdge, orbPlaceBall, orbNotes, orbSaveNote, orbDelNote, orbInsert, orbCopy, refreshOrbBadge, ORB_MODULES, orbModule,
        get orbEdge() { return orbEdge; }, set orbEdge(v) { orbEdge = v; },
        get orbOpenNow() { return orbOpenNow; }, set orbOpenNow(v) { orbOpenNow = v; },
        orbWbCharKey, orbWbCurChar, orbWbChatId, orbWbChatKey, orbWbBinds, orbWbApplied, orbWbRecord,
        orbWbBound, orbWbSetBound, orbWbToggleBound, orbWbCharNames, orbWbIsBound, orbWbAuto, orbWbState, orbWbTargetChar,
        orbWorldList, orbWbActive, orbWbEnabled, orbWbEnabledSet, orbWbSelApply, orbWbSyncChar,
        orbEntryIcon, orbEntryStateText, orbEntryKeys, orbEntryLen, orbEntriesOf, orbEntryAdd, orbEntrySave,
        orbEntryToggle, orbEntryDel, orbEntryDelMany, orbEntryRowHTML, orbEntryFormHTML, orbEntryListHTML, orbEntryFormCascade,
        orbDlcBook, orbDlcConstantDefault, orbDlcEnsureBook, orbDlcFirstRun, orbDlcAddSeed, orbDlcFetch, orbDlcEnsure, orbDlcHTML, orbDlcRowsHTML,
        DLC_SEED, orbMakeEntry, orbEntryAddMany, orbEntriesCount,
        orbWbOpenEntries, orbWbCloseEntries, orbWbEntriesFetch, orbWbEntriesHTML,
        orbWbCats, orbWbCatNames, orbWbCatOf, orbWbCatCount, orbWbCatAdd, orbWbCatDel, orbWbCatRename, orbWbCatSet,
        orbNoteCatNames, orbNoteCatOf, orbNoteCatCount, orbNoteCatAdd, orbNoteCatDel, orbNoteCatRename, orbNoteCatSet,
        orbNotes, orbNotesHTML, orbNoteRowsHTML, orbSaveNote, orbDelNote, orbNoteMatch,
        orbCatBarHTML, orbCatPickHTML, orbCatNewHTML, orbCatClearPickers, orbAskCatName,
        bindWbWatch, orbWbReread,
        get orbNCat() { return orbNCat; }, set orbNCat(v) { orbNCat = v; },
        get orbNCatEdit() { return orbNCatEdit; }, set orbNCatEdit(v) { orbNCatEdit = v; },
        get orbNCatPick() { return orbNCatPick; }, set orbNCatPick(v) { orbNCatPick = v; },
        get orbNCatNew() { return orbNCatNew; }, set orbNCatNew(v) { orbNCatNew = v; },
        get orbWbCat() { return orbWbCat; }, set orbWbCat(v) { orbWbCat = v; },
        get orbThemeEdit() { return orbThemeEdit; }, set orbThemeEdit(v) { orbThemeEdit = v; },
        get orbThemeDraft() { return orbThemeDraft; }, set orbThemeDraft(v) { orbThemeDraft = v; },
        orbThemeEditHTML, orbThemeCss, orbThemePreview, orbThemeSyncToSt, orbThemeClickSt,
        orbThemeObject, orbThemeCreate, orbAskText,
        get orbDelConfirm() { return orbDelConfirm; }, set orbDelConfirm(v) { orbDelConfirm = v; },
        get orbWbCatEdit() { return orbWbCatEdit; }, set orbWbCatEdit(v) { orbWbCatEdit = v; },
        get orbWbCatPick() { return orbWbCatPick; }, set orbWbCatPick(v) { orbWbCatPick = v; },
        ORB_CAT_ALL,
        get orbWbEntriesBook() { return orbWbEntriesBook; }, set orbWbEntriesBook(v) { orbWbEntriesBook = v; },
        get orbWbEntries() { return orbWbEntries; }, set orbWbEntries(v) { orbWbEntries = v; },
        get orbWbEntryOpen() { return orbWbEntryOpen; }, set orbWbEntryOpen(v) { orbWbEntryOpen = v; },
        get orbWbEntriesLoaded() { return orbWbEntriesLoaded; }, set orbWbEntriesLoaded(v) { orbWbEntriesLoaded = v; },
        get orbDlcEntries() { return orbDlcEntries; }, set orbDlcEntries(v) { orbDlcEntries = v; },
        get orbDlcOpen() { return orbDlcOpen; }, set orbDlcOpen(v) { orbDlcOpen = v; },
        get orbDlcLoaded() { return orbDlcLoaded; }, set orbDlcLoaded(v) { orbDlcLoaded = v; },
        /* v1.31.59：DLC 条目 ↔ 面具 */
        orbDlcBook, dlcMaskTable,
        dlcEntryMasks, dlcMaskToggle, dlcMaskClear, dlcMaskPrune, dlcMaskNames, dlcPersonaName,
        dlcPersonaEntryCount, dlcWornPersona, dlcEntryState, dlcEntryEffective, dlcFilterEntries,
        bindDlcMaskWatch, dlcGlobalOn, dlcGlobalApply, dlcGlobalSelected, dlcMaskPickerHTML,
        get dlcTempOff() { return dlcTempOff; },
        get orbDlcFilter() { return orbDlcFilter; }, set orbDlcFilter(v) { orbDlcFilter = v; },
        get orbTab() { return orbTab; }, set orbTab(v) { orbTab = v; },
        get orbDlcMaskFor() { return orbDlcMaskFor; }, set orbDlcMaskFor(v) { orbDlcMaskFor = v; },
        get dlcWornCache() { return dlcWornCache; }, set dlcWornCache(v) { dlcWornCache = v; },
        /* v1.31.65：选卡 / 写卡两页的影子根隔离 */
        SSP_SHADOW_HOST, sspIsShadowTab, sspTabRoot, sspShadowRoot, sspShadowRender, sspShadowCss,
        sspInstallTestQueryShim,
        /* v1.31.63：页签收纳 */
        orbTabsHTML, orbTabMenuHTML, orbTabsFit, orbTabHidden, orbTabIsHidden, orbTabHideSet, orbTabOverflowIds,
        /* v1.31.64：面具 ↔ 存档 */
        personaChatBinds, personaChatKeyOf, personaChatKeyCur, personaChatBindOf, personaChatBindSet,
        personaChatCount, personaChatNative, personaChatApply, orbChatMaskPickerHTML,
        get personaBindTab() { return personaBindTab; }, set personaBindTab(v) { personaBindTab = v; },
        get personaChatMaskKey() { return personaChatMaskKey; }, set personaChatMaskKey(v) { personaChatMaskKey = v; },
        get orbChatList() { return orbChatList; }, set orbChatList(v) { orbChatList = v; },
        get orbTabMenu() { return orbTabMenu; }, set orbTabMenu(v) { orbTabMenu = v; },
        get orbTabMenuEdit() { return orbTabMenuEdit; }, set orbTabMenuEdit(v) { orbTabMenuEdit = v; },
        get orbTabSqueeze() { return orbTabSqueeze; },
        /* v1.31.60：消息查找 */
        orbFindHTML, orbFindBodyHTML, findRun, findFiltered, findRows, findStripThink, findSnippet, findTextOf,
        findUseThink, orbFindGo, orbFindStep,
        get orbFindQ() { return orbFindQ; }, set orbFindQ(v) { orbFindQ = v; },
        get orbFindCat() { return orbFindCat; }, set orbFindCat(v) { orbFindCat = v; },
        get orbFindCur() { return orbFindCur; }, set orbFindCur(v) { orbFindCur = v; },
        get orbFindSort() { return orbFindSort; }, set orbFindSort(v) { orbFindSort = v; },
        get orbFindShow() { return orbFindShow; }, set orbFindShow(v) { orbFindShow = v; },
        orbWbApplyForChar, orbWbCleanup, orbWbRestoreCur, orbWbOnChatChanged,
        orbWbApplied, orbWbEnabled, orbWbCurChar, orbWbBound, orbWbActive, orbWbSyncChar,
        orbWorldRefresh, orbWorldHTML, orbWorldRowsHTML, orbWorldPickerHTML,
        renderOrbPanel, orbPanelHTML, orbScrollIntoView,
        orbOnCharChanged, protectSkinAfterThemeChange, cardImportantify,
        get orbLastCharId() { return orbLastCharId; }, set orbLastCharId(v) { orbLastCharId = v; },
        get orbWbBinding() { return orbWbBinding; }, set orbWbBinding(v) { orbWbBinding = v; },
        get orbWbSearch() { return orbWbSearch; }, set orbWbSearch(v) { orbWbSearch = v; },
        get orbWbLastKey() { return orbWbLastKey; }, set orbWbLastKey(v) { orbWbLastKey = v; },
        mountSettingsPanel, openSettingsPanel, closeSettingsPanel, panelOpen, settingsPanelHTML, bindSettings, refreshCardSection, trimListCreatorNotes,
        sspIntegrityProbe, sspHookErrors, sspPushErr, SSP_ERR_LOG, SSP_ERR_KEEP, sspBoxOf,
        orbEditorOpen, orbEditorMount, orbEditorUnmount, orbEditorMountSoon, orbCardOpen, orbCardNew, orbOpenNativeList,
        CH_TABS, get chTab() { return chTab; }, set chTab(v) { chTab = v; },
        VAULT_SCHEMA, VAULT_GROUPS, chFldById, chTabFields, chGroupsHTML, chRowHTML, chFldHTML, chAvatarRowHTML,
        chPull, chPush, chSave, chVal, chMine, chSetMine, chDirtyReset, chPanesClear, chSyncTagChips, chCount, chPanesLoad,
        chMountFrame, chUnmountFrame, chOverlay, chOverlayClose, chNative, chRefreshAvatars,
        chRefreshSpecial, chFillSelects, chRefreshHead, chSyncFav, chSay, chSavebarInit,
        chGreetArr, chGreetAdd, chGreetDel, chGreetMove, chGreetRender, chGreetRowsRender, chGreetChipsRender,
        chGreetSetGroup, chGreetSetText, chGreetGroups, chGreetText, chGreetGroup,
        chTagPool, chTagsRecollect, chTagsDatalist, chNativeEl, chPinSheet,
        QUICK_BUTTONS, QUICK_BAR_ID, quickBarSettings, qbList, qbHTML, qbMount, qbPlace, qbRun, qbScrollBottom, qbBind,
        QB_ANCHORS, QB_ANCHOR_NAME,
        orbBeautyHTML, orbBeautyOn, orbBeautySet, orbBeautyReset, orbBeautyApply, ORB_BEAUTY_TWEAKS,
        get chGreetOpen() { return chGreetOpen; }, set chGreetOpen(v) { chGreetOpen = v; },
        get chGreetPick() { return chGreetPick; }, set chGreetPick(v) { chGreetPick = v; },
        get chDirty() { return chDirty; }, get chTabNow() { return chTab; },
        orbPickHTML, orbCardsList, orbCardAvatarUrl, orbRecentCards, orbCardListRowHTML, orbCardGroupEditorHTML,
        chCardGroupOf, chCardSetGroup, chCardGroupNames, chCardMove, chCardInPick, chPickCurList,
        get orbPickView() { return orbPickView; }, set orbPickView(v) { orbPickView = v; },
        get orbPickGroup() { return orbPickGroup; }, set orbPickGroup(v) { orbPickGroup = v; },
        get chCardEdit() { return chCardEdit; }, set chCardEdit(v) { chCardEdit = v; },
        get boxOpen() { return boxOpen; }, set boxOpen(v) { boxOpen = v; },
        get renaming() { return renaming; }, set renaming(v) { renaming = v; },
        get drag() { return drag; }, set drag(v) { drag = v; },
        onMountClick, onMountChange, onMountDragStart, onMountDrop, editorHTML, started,
    };
}