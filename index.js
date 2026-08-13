/**
 * 鼠鼠小助手 ShuShu Tweaks
 * ----------------------------------------
 * 功能一：思维链收纳（Thinking Shield）
 *   1) 生成拦截器：任何生成（普通/续写/重roll/swipe）发起前，先把聊天里的
 *      <think> 块从正文转移到 extra.reasoning（原生折叠块），保证发给模型
 *      的 prompt 是干净的 —— 根治"续写后思维链被吐回正文、格式变乱"。
 *   2) 消息格式化钩子：显示层兜底剥离思维链标签（含流式输出时未闭合的
 *      半截标签），屏幕上一个字符都不会闪出来。
 *   3) 生成结束/收到消息/切换聊天：把存量的思维链也收纳进 extra.reasoning
 *      并保存聊天记录，数据层彻底干净。
 *
 * 功能二：角色卡导入检测同名
 *   点击"导入角色"选择 PNG/JSON 卡时，先解析卡片名字；若已有同名角色，
 *   弹窗询问"更新原角色 / 仍然新建 / 取消"。更新走 /api/characters/edit，
 *   保留原角色的聊天记录绑定、收藏、标签和世界书链接。
 */

const MODULE_NAME = 'tavern_tweaks';
const LOG_PREFIX = '[TavernTweaks]';

/** 默认设置 */
const defaultSettings = Object.freeze({
    shieldEnabled: true,        // 思维链收纳总开关
    cleanHistoryOnChatLoad: true, // 切换/加载聊天时清理历史消息里的思维链
    thinkTags: 'think,thinking,thought', // 需要收纳的标签（逗号分隔）
    importUpdateEnabled: true,  // 导入时检测同名角色
    replaceAvatarOnUpdate: false, // 更新同名角色时是否同时替换头像
});

/* ============================== 基础工具 ============================== */

function getContextSafe() {
    return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext)
        ? SillyTavern.getContext()
        : null;
}

function getSettings() {
    const ctx = getContextSafe();
    if (!ctx) return structuredClone(defaultSettings);
    const store = ctx.extensionSettings;
    if (!store[MODULE_NAME]) {
        store[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(store[MODULE_NAME], key)) {
            store[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return store[MODULE_NAME];
}

function saveSettings() {
    getContextSafe()?.saveSettingsDebounced?.();
}

/**
 * 带 CSRF 令牌的 API 请求头。
 * 酒馆默认开启 CSRF 防护，裸 fetch 调 /api/* 会被 403 拒绝。
 * 注意：FormData（multipart）请求必须删掉 Content-Type，
 * 让浏览器自动生成带 boundary 的头，否则服务端解析不到字段。
 * @param {boolean} forJson 是否为 JSON 请求体
 */
function getApiHeaders(forJson) {
    const fn = getContextSafe()?.getRequestHeaders;
    if (typeof fn !== 'function') {
        return forJson ? { 'Content-Type': 'application/json' } : undefined;
    }
    const headers = { ...fn() };
    if (!forJson) delete headers['Content-Type'];
    return headers;
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getThinkTags() {
    return getSettings().thinkTags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
}

/* ====================== 功能一：思维链收纳核心 ====================== */

/**
 * 从文本中提取思维链块，返回清理后的正文。
 * 同时处理闭合标签与流式输出中"开了头没闭合"的半截标签。
 * @param {string} text
 * @param {string[]} tags
 * @returns {{text: string, blocks: string[], changed: boolean}}
 */
function extractThinking(text, tags) {
    if (typeof text !== 'string' || text.length === 0) {
        return { text, blocks: [], changed: false };
    }
    const blocks = [];
    let out = text;
    for (const tag of tags) {
        const esc = escapeRegExp(tag);
        // 完整闭合的 <tag>...</tag>
        const full = new RegExp(`<${esc}\\b[^>]*>([\\s\\S]*?)<\\/${esc}\\s*>`, 'gi');
        out = out.replace(full, (_, inner) => {
            if (inner && inner.trim()) blocks.push(inner.trim());
            return '';
        });
        // 未闭合的 <tag>...（一直到文本末尾，流式续写时的典型形态）
        const partial = new RegExp(`<${esc}\\b[^>]*>([\\s\\S]*)$`, 'gi');
        out = out.replace(partial, (_, inner) => {
            if (inner && inner.trim()) blocks.push(inner.trim());
            return '';
        });
    }
    // 轻量整理：压缩多余空行，不动其余格式
    const cleaned = out.replace(/\n{3,}/g, '\n\n').trim();
    return { text: cleaned, blocks, changed: out !== text };
}

/**
 * 把一条消息里的思维链收纳到 extra.reasoning。
 * @param {object} message 聊天消息对象（原地修改）
 * @returns {boolean} 是否有改动
 */
function applyThinkingShield(message) {
    if (!message || message.is_user || message.is_system) return false;
    if (typeof message.mes !== 'string') return false;

    const result = extractThinking(message.mes, getThinkTags());
    if (!result.changed) return false;

    message.mes = result.text;
    const joined = result.blocks.join('\n\n').trim();
    if (joined) {
        message.extra = message.extra || {};
        message.extra.reasoning = message.extra.reasoning
            ? `${message.extra.reasoning.trim()}\n\n${joined}`
            : joined;
    }
    console.debug(`${LOG_PREFIX} 已收纳思维链:`, message.name ?? '');
    return true;
}

async function saveChatSafe() {
    const ctx = getContextSafe();
    try {
        if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        else if (typeof ctx?.saveChatConditional === 'function') await ctx.saveChatConditional();
    } catch (error) {
        console.warn(`${LOG_PREFIX} 保存聊天失败:`, error);
    }
}

/**
 * 已被收纳但界面还没重绘的消息 id 集合。
 * 思维链不是删除，而是转移到了 extra.reasoning（原生折叠块），
 * 需要重绘界面后折叠块才会出现（可展开、可编辑）。
 */
const pendingRefreshIds = new Set();

/**
 * 重绘聊天界面，让原生思维链折叠块渲染出来。
 * 优先用酒馆自带的"重新加载聊天"；旧版本退化为逐条触发 MESSAGE_EDITED。
 */
async function refreshMessagesUI() {
    if (pendingRefreshIds.size === 0) return;
    const ctx = getContextSafe();
    const ids = [...pendingRefreshIds];
    pendingRefreshIds.clear();
    try {
        if (typeof ctx?.reloadCurrentChat === 'function') {
            await ctx.reloadCurrentChat();
            return;
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} reloadCurrentChat 失败，尝试逐条刷新:`, error);
    }
    const { eventSource, event_types } = ctx ?? {};
    if (!eventSource) return;
    for (const id of ids) {
        try {
            await eventSource.emit(event_types?.MESSAGE_EDITED ?? 'MESSAGE_EDITED', id);
        } catch { /* 忽略单条失败 */ }
    }
}

/**
 * 生成拦截器（manifest.generate_interceptor 指定）。
 * 在任何生成发起前清理 chat 数组 —— 续写时模型拿到的就是干净文本。
 */
globalThis.tavernTweaksInterceptor = async function (chat, _contextSize, _abort, _type) {
    try {
        if (!getSettings().shieldEnabled) return;
        if (!Array.isArray(chat)) return;
        let changed = false;
        for (let i = 0; i < chat.length; i++) {
            if (applyThinkingShield(chat[i])) {
                changed = true;
                // 此处不能立刻重绘（生成即将开始），先记下来，等生成结束统一刷新
                pendingRefreshIds.add(i);
            }
        }
        if (changed) await saveChatSafe();
    } catch (error) {
        console.error(`${LOG_PREFIX} 拦截器出错:`, error);
    }
};

/** 显示层兜底：在正则规则之前剥离思维链标签（含流式半截标签）。 */
function registerDisplayHook() {
    const ctx = getContextSafe();
    const formatter = ctx?.messageFormatter;
    if (!formatter || typeof formatter.addHook !== 'function') {
        console.warn(`${LOG_PREFIX} 当前酒馆版本没有 messageFormatter，显示层钩子未启用（存储层防护仍有效）`);
        return;
    }
    formatter.addHook((mes, hookCtx) => {
        try {
            if (!getSettings().shieldEnabled) return mes;
            if (hookCtx.isUser || hookCtx.isSystem || hookCtx.isReasoning) return mes;
            const result = extractThinking(mes, getThinkTags());
            return result.changed ? result.text : mes;
        } catch {
            return mes;
        }
    }, {
        stage: formatter.stage?.BEFORE_REGEX ?? 'beforeRegex',
        order: formatter.order?.EARLIEST ?? 0,
    });
    console.log(`${LOG_PREFIX} 显示层钩子已注册`);
}

/** 事件层：生成结束 / 收到消息 / 切换聊天时清理存量数据。 */
function registerEventHandlers() {
    const ctx = getContextSafe();
    const { eventSource, event_types } = ctx ?? {};
    if (!eventSource || !event_types) {
        console.error(`${LOG_PREFIX} 无法获取 eventSource，事件层未启用`);
        return;
    }

    eventSource.on(event_types.MESSAGE_RECEIVED, async (mesId) => {
        if (!getSettings().shieldEnabled) return;
        const chat = getContextSafe()?.chat;
        const message = chat?.[mesId];
        if (message && applyThinkingShield(message)) await saveChatSafe();
    });

    eventSource.on(event_types.GENERATION_ENDED, async () => {
        if (!getSettings().shieldEnabled) return;
        const chat = getContextSafe()?.chat;
        if (!Array.isArray(chat)) return;
        let changed = false;
        // 只扫最后几条，续写/重roll 的影响范围都在尾部
        for (let i = Math.max(0, chat.length - 5); i < chat.length; i++) {
            if (applyThinkingShield(chat[i])) {
                changed = true;
                pendingRefreshIds.add(i);
            }
        }
        if (changed) await saveChatSafe();
        // 生成已结束，统一把收纳过思维链的消息重绘出折叠块
        await refreshMessagesUI();
    });

    eventSource.on(event_types.GENERATION_STOPPED, async () => {
        // 手动停止生成时也要把待刷新的折叠块补上
        await refreshMessagesUI();
    });

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const settings = getSettings();
        if (!settings.shieldEnabled || !settings.cleanHistoryOnChatLoad) return;
        const chat = getContextSafe()?.chat;
        if (!Array.isArray(chat)) return;
        let changed = false;
        for (let i = 0; i < chat.length; i++) {
            if (applyThinkingShield(chat[i])) {
                changed = true;
                pendingRefreshIds.add(i);
            }
        }
        if (changed) {
            await saveChatSafe();
            await refreshMessagesUI();
            toastr.info('已收纳历史消息中的思维链（点开消息上方的"思考"折叠块即可查看/编辑）', '鼠鼠小助手');
        }
    });

    console.log(`${LOG_PREFIX} 事件层已注册`);
}

/* ==================== 功能二：角色卡导入同名检测 ==================== */

let bypassImportIntercept = false;

/**
 * 解析 PNG 角色卡（tEXt / iTXt / zTXt 中的 chara 数据）。
 * @param {File} file
 * @returns {Promise<object|null>} 卡片 JSON
 */
async function readPngCard(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (buf.length < 8 || !sig.every((b, i) => buf[i] === b)) return null;

    const decoder = new TextDecoder();
    const ascii = (arr) => String.fromCharCode(...arr);
    const readU32 = (off) =>
        (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0;

    async function decodeTextPayload(bytes) {
        // 内容是 base64 编码的 UTF-8 JSON
        const b64 = decoder.decode(bytes);
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return JSON.parse(new TextDecoder('utf-8').decode(raw));
    }

    let offset = 8;
    while (offset + 12 <= buf.length) {
        const length = readU32(offset);
        const type = ascii(buf.subarray(offset + 4, offset + 8));
        const dataStart = offset + 8;
        const data = buf.subarray(dataStart, dataStart + length);

        if (type === 'IEND') break;

        try {
            if (type === 'tEXt') {
                const nul = data.indexOf(0);
                if (nul > 0 && ascii(data.subarray(0, nul)) === 'chara') {
                    return await decodeTextPayload(data.subarray(nul + 1));
                }
            } else if (type === 'zTXt') {
                const nul = data.indexOf(0);
                if (nul > 0 && ascii(data.subarray(0, nul)) === 'chara') {
                    const compressed = data.subarray(nul + 2); // 跳过 keyword + 压缩方式字节
                    const ds = new DecompressionStream('deflate');
                    const plain = await new Response(
                        new Blob([compressed]).stream().pipeThrough(ds)
                    ).arrayBuffer();
                    return await decodeTextPayload(new Uint8Array(plain));
                }
            } else if (type === 'iTXt') {
                const nul = data.indexOf(0);
                if (nul > 0 && ascii(data.subarray(0, nul)) === 'chara') {
                    let p = nul + 1;
                    const compressionFlag = data[p]; p += 2; // flag + method
                    const skipNul = () => { while (p < data.length && data[p] !== 0) p++; p++; };
                    skipNul(); // language tag
                    skipNul(); // translated keyword
                    let payload = data.subarray(p);
                    if (compressionFlag === 1) {
                        const ds = new DecompressionStream('deflate');
                        const plain = await new Response(
                            new Blob([payload]).stream().pipeThrough(ds)
                        ).arrayBuffer();
                        payload = new Uint8Array(plain);
                    }
                    return JSON.parse(new TextDecoder('utf-8').decode(payload));
                }
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX} 解析 PNG 卡片数据失败:`, error);
            return null;
        }

        offset = dataStart + length + 4; // +4 CRC
    }
    return null;
}

async function readCardFile(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) return JSON.parse(await file.text());
    if (lower.endsWith('.png')) return await readPngCard(file);
    return null;
}

function getCardName(card) {
    return (card?.data?.name ?? card?.name ?? '').toString().trim();
}

function findDuplicateCharacter(name) {
    const chars = getContextSafe()?.characters;
    if (!Array.isArray(chars)) return null;
    const target = name.trim().toLowerCase();
    return chars.find(c => (c?.name ?? '').trim().toLowerCase() === target) ?? null;
}

async function askUpdateOrNew(name) {
    const ctx = getContextSafe();
    // 注意：酒馆的弹窗返回的是数值枚举 POPUP_RESULT（1=确定, 0=否定, null=取消），
    // 不是布尔值！用 === true / === false 判断会导致两个按钮都落入 cancel。
    const RESULT = ctx?.POPUP_RESULT ?? { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null };
    const message = `检测到同名角色「${name}」。<br><br>`
        + `<b>更新原角色</b>：用新卡内容覆盖原角色（保留聊天记录、收藏与标签）<br>`
        + `<b>新建副本</b>：保留原角色，另外创建一个新角色`;

    // 优先使用支持自定义按钮文字的弹窗，语义更清晰
    if (ctx?.callGenericPopup && ctx?.POPUP_TYPE?.CONFIRM !== undefined) {
        const result = await ctx.callGenericPopup(message, ctx.POPUP_TYPE.CONFIRM, '', {
            okButton: '更新原角色',
            cancelButton: '新建副本',
        });
        if (result === RESULT.AFFIRMATIVE || result === true) return 'update';
        if (result === RESULT.NEGATIVE || result === false) return 'new';
        return 'cancel'; // 关闭/ESC
    }
    if (ctx?.Popup?.show?.confirm) {
        const result = await ctx.Popup.show.confirm('导入角色卡', `${message}<br><br>「确定」= 更新原角色，「取消」= 新建副本`);
        if (result === RESULT.AFFIRMATIVE || result === true) return 'update';
        if (result === RESULT.NEGATIVE || result === false) return 'new';
        return 'cancel'; // 关闭/ESC
    }
    if (window.confirm(`检测到同名角色「${name}」。\n「确定」= 更新原角色，「取消」= 新建副本`)) return 'update';
    return window.confirm('仍然新建一个副本吗？') ? 'new' : 'cancel';
}

/** 让原生导入流程继续处理这个文件（用于无同名/用户选"新建"的情况）。 */
function fallbackToNativeImport(input) {
    bypassImportIntercept = true;
    input.dispatchEvent(new Event('change'));
}

async function fetchFullCharacterData(avatar) {
    try {
        const res = await fetch('/api/characters/get', {
            method: 'POST',
            headers: getApiHeaders(true),
            body: JSON.stringify({ avatar_url: avatar }),
        });
        if (!res.ok) return null;
        // 返回完整角色对象（含顶层 chat / create_date 与 v2 data 子对象）
        return await res.json();
    } catch (error) {
        console.warn(`${LOG_PREFIX} 拉取原角色数据失败:`, error);
        return null;
    }
}

async function updateExistingCharacter(existingChar, card, file) {
    const ctx = getContextSafe();
    const settings = getSettings();
    const name = getCardName(card);
    const newData = structuredClone(card.data ?? card);

    // 拉取原角色完整数据，做保护性合并
    const existingFull = await fetchFullCharacterData(existingChar.avatar) ?? {};
    const existingData = existingFull.data ?? existingFull; // v2 data 子对象
    const oldExt = existingData.extensions ?? {};
    const newExt = newData.extensions ?? {};
    const oldTags = Array.isArray(existingData.tags) ? existingData.tags : (existingChar.tags ?? []);
    const newTags = Array.isArray(newData.tags) ? newData.tags : [];

    const mergedData = {
        ...newData,
        name,
        // 本地手动打过的标签与新卡标签取并集，避免覆盖用户整理结果
        tags: [...new Set([...oldTags, ...newTags])],
        extensions: {
            ...oldExt,
            ...newExt,
            // 收藏与世界书链接永远以本地为准
            fav: existingChar.fav ?? oldExt.fav ?? false,
            world: oldExt.world ?? newExt.world ?? '',
        },
    };

    const dp = mergedData.extensions?.depth_prompt ?? {};
    const fd = new FormData();
    fd.append('avatar_url', existingChar.avatar);
    fd.append('ch_name', name);
    // 保留原角色的"上次聊天"绑定（服务端会直接采用 request.body.chat）
    fd.append('chat', existingFull.chat ?? existingChar.chat ?? '');
    fd.append('description', mergedData.description ?? '');
    fd.append('first_mes', mergedData.first_mes ?? '');
    fd.append('mes_example', mergedData.mes_example ?? '');
    fd.append('personality', mergedData.personality ?? '');
    fd.append('scenario', mergedData.scenario ?? '');
    // 服务端读取的字段名是 creator_notes，不是 creatorcomment
    fd.append('creator_notes', mergedData.creator_notes ?? '');
    fd.append('creator', mergedData.creator ?? '');
    fd.append('character_version', String(mergedData.character_version ?? ''));
    fd.append('tags', mergedData.tags.join(','));
    // 服务端把字符串当作单条问候语处理，必须像原生表单一样逐条 append
    for (const greeting of mergedData.alternate_greetings ?? []) {
        fd.append('alternate_greetings', String(greeting));
    }
    fd.append('system_prompt', mergedData.system_prompt ?? '');
    fd.append('post_history_instructions', mergedData.post_history_instructions ?? '');
    fd.append('depth_prompt_prompt', dp.prompt ?? '');
    fd.append('depth_prompt_depth', String(dp.depth ?? 4));
    fd.append('depth_prompt_role', dp.role ?? 'system');
    fd.append('talkativeness', String(mergedData.extensions?.talkativeness ?? 0.5));
    fd.append('fav', String(!!mergedData.extensions?.fav));
    fd.append('world', mergedData.extensions?.world ?? '');
    // 服务端深合并的字段名是 extensions（JSON 字符串），不是 data_extensions
    fd.append('extensions', JSON.stringify(mergedData.extensions ?? {}));
    fd.append('spec', 'chara_card_v2');
    fd.append('spec_version', '2.0');
    fd.append('create_date', existingChar.create_date ?? existingFull.create_date ?? '');
    fd.append('json_data', JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: mergedData,
    }));
    if (settings.replaceAvatarOnUpdate && file) {
        fd.append('avatar', file);
    }

    const res = await fetch('/api/characters/edit', { method: 'POST', headers: getApiHeaders(false), body: fd });
    if (!res.ok) {
        const detail = (await res.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
        throw new Error(`服务器返回 ${res.status}${detail ? `：${detail}` : ''}`);
    }

    // 刷新角色列表
    try {
        if (typeof ctx?.getCharacters === 'function') await ctx.getCharacters();
    } catch (error) {
        console.warn(`${LOG_PREFIX} 刷新角色列表失败:`, error);
    }
    toastr.success(`已更新同名角色「${name}」`, '鼠鼠小助手');
}

/** 文档级捕获监听：抢在酒馆原生 change 处理之前拿到导入文件。 */
function setupImportInterceptor() {
    document.addEventListener('change', async (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.id !== 'character_import_file') return;

        if (bypassImportIntercept) { bypassImportIntercept = false; return; }
        if (!getSettings().importUpdateEnabled) return;

        const file = input.files?.[0];
        if (!file) return;
        const lower = file.name.toLowerCase();
        if (!lower.endsWith('.png') && !lower.endsWith('.json')) return; // charx/webp 等交给原生流程

        // 拦截原生处理
        event.stopImmediatePropagation();
        event.preventDefault();

        try {
            const card = await readCardFile(file);
            const name = card ? getCardName(card) : '';
            if (!name) return fallbackToNativeImport(input);

            const duplicate = findDuplicateCharacter(name);
            if (!duplicate) return fallbackToNativeImport(input);

            const choice = await askUpdateOrNew(name);
            if (choice === 'new') return fallbackToNativeImport(input);
            if (choice === 'cancel') { input.value = ''; return; }

            await updateExistingCharacter(duplicate, card, file);
        } catch (error) {
            console.error(`${LOG_PREFIX} 导入处理失败:`, error);
            toastr.error(`同名角色更新失败（${error?.message ?? '未知错误'}），已回退到原生导入`, '鼠鼠小助手');
            return fallbackToNativeImport(input);
        } finally {
            // 允许再次选择同一文件
            if (!bypassImportIntercept) input.value = '';
        }
    }, true);
    console.log(`${LOG_PREFIX} 导入拦截已启用`);
}

/* ============================== 设置面板 ============================== */

function addSettingsPanel() {
    const settings = getSettings();
    const container = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
    if (!container) return;

    const html = `
    <div class="tavern_tweaks_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🐭 鼠鼠小助手 ShuShu Tweaks</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label" for="tt_shield_enabled">
                    <input id="tt_shield_enabled" type="checkbox" ${settings.shieldEnabled ? 'checked' : ''}>
                    <span>思维链收纳（防止续写暴露 think 内容）</span>
                </label>
                <label class="checkbox_label" for="tt_clean_history">
                    <input id="tt_clean_history" type="checkbox" ${settings.cleanHistoryOnChatLoad ? 'checked' : ''}>
                    <span>加载聊天时清理历史消息中的思维链</span>
                </label>
                <label for="tt_think_tags"><span>思维链标签（逗号分隔）</span></label>
                <input id="tt_think_tags" class="text_pole" type="text" value="${settings.thinkTags}">
                <hr>
                <label class="checkbox_label" for="tt_import_update">
                    <input id="tt_import_update" type="checkbox" ${settings.importUpdateEnabled ? 'checked' : ''}>
                    <span>导入角色卡时检测同名角色（提示更新原角色）</span>
                </label>
                <label class="checkbox_label" for="tt_replace_avatar">
                    <input id="tt_replace_avatar" type="checkbox" ${settings.replaceAvatarOnUpdate ? 'checked' : ''}>
                    <span>更新同名角色时同时替换头像图片</span>
                </label>
            </div>
        </div>
        <hr>
    </div>`;

    container.insertAdjacentHTML('beforeend', html);

    const bind = (id, key, isText = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(isText ? 'input' : 'change', () => {
            const s = getSettings();
            s[key] = isText ? el.value : el.checked;
            saveSettings();
        });
    };
    bind('tt_shield_enabled', 'shieldEnabled');
    bind('tt_clean_history', 'cleanHistoryOnChatLoad');
    bind('tt_think_tags', 'thinkTags', true);
    bind('tt_import_update', 'importUpdateEnabled');
    bind('tt_replace_avatar', 'replaceAvatarOnUpdate');
}

/* ============================== 启动 ============================== */

jQuery(async () => {
    try {
        const ctx = getContextSafe();
        if (!ctx) {
            console.error(`${LOG_PREFIX} 无法获取 SillyTavern 上下文，插件未启动`);
            return;
        }
        getSettings();
        registerDisplayHook();
        registerEventHandlers();

        const initImport = () => setupImportInterceptor();
        if (ctx.eventSource && ctx.event_types?.APP_READY) {
            ctx.eventSource.on(ctx.event_types.APP_READY, () => setTimeout(initImport, 500));
        } else {
            setTimeout(initImport, 1500);
        }

        addSettingsPanel();
        console.log(`${LOG_PREFIX} 已加载`);
    } catch (error) {
        console.error(`${LOG_PREFIX} 启动失败:`, error);
    }
});
