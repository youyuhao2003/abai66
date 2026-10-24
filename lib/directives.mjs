// 指令系统:6 种剧情指令

export const DIRECTIVE_TYPES = {
  Continue: {
    label: '剧情续写',
    hint: '给一个方向或情绪基调，模型会顺势写下去。例：让气氛慢慢紧张起来，她开始怀疑我隐瞒了什么',
    placeholder: '输入一个方向或情绪基调…',
    maxLen: 300,
    build: text => `【指令 · 剧情续写】请顺着当前情境自然往下写。方向:${text || '（自由发挥）'}`,
  },
  Expand: {
    label: '剧情扩写',
    hint: '输入接下来想看到的剧情。例：她在咖啡馆门口拦住我，犹豫了很久，最后还是说出那个秘密',
    placeholder: '描述接下来想看到的剧情…',
    maxLen: 500,
    build: text => `【指令 · 剧情扩写】请把下面的情节展开成完整场景:${text}`,
  },
  CustomStyleOverride: {
    label: '风格定制',
    hint: '描述你想要的写作风格或语气。例：用更克制的笔调，多写环境烘托情绪，少用直接对话',
    placeholder: '描述想要的写作风格或语气…',
    maxLen: 300,
    build: text => `【指令 · 风格定制】本次回复请遵循以下风格要求:${text}`,
  },
  SceneTransition: {
    label: '场景转换',
    hint: '指定跳到的时间或地点，可附加新场景氛围。例：跳到三天后的深夜，她独自坐在天台抽烟，城市灯火映在眼里',
    placeholder: '指定时间 / 地点 / 新场景氛围…',
    maxLen: 400,
    build: text => `【指令 · 场景转换】请直接跳到以下场景继续故事:${text}`,
  },
  PerspectiveSwitch: {
    label: '视角切换',
    hint: '指定切到谁的视角，可附加该视角下的情绪。例：切到她的第一人称视角，写她此刻矛盾又心动的内心独白',
    placeholder: '指定视角与情绪…',
    maxLen: 300,
    build: text => `【指令 · 视角切换】本次回复切换为:${text}`,
  },
  SettingOverride: {
    label: '设定覆盖',
    hint: '声明新的设定或事实，模型会按此继续写。例：从现在起我突然能听见她的心声，但她毫不知情',
    placeholder: '声明新的设定 / 事实…',
    maxLen: 400,
    build: text => `【指令 · 设定覆盖】从现在起，以下设定生效并持续影响后续剧情:${text}`,
  },
};

export function isDirectiveType(t) {
  return Object.prototype.hasOwnProperty.call(DIRECTIVE_TYPES, t);
}

export function buildDirectivePrompt(type, text) {
  const d = DIRECTIVE_TYPES[type];
  if (!d) return null;
  return d.build(String(text || '').slice(0, d.maxLen));
}

/** 前端用的元数据(不含 build 函数) */
export function directiveMeta() {
  return Object.entries(DIRECTIVE_TYPES).map(([key, v]) => ({
    key, label: v.label, hint: v.hint, placeholder: v.placeholder, maxLen: v.maxLen,
  }));
}

// ---------- 快捷格式工具栏 ----------
export const QUICK_FORMAT = {
  dialogue:      { label: '说话', wrap: ['"', '"'],   hint: '插入引号，把选中的内容标记成说出来的话' },
  scene:         { label: '剧情', wrap: ['[', ']'],   hint: '插入 [剧情推进] 方括号' },
  monologue:     { label: '行动', wrap: ['（', '）'], hint: '插入圆括号，表示行动描写' },
  director:      { label: '指令', wrap: null,         hint: '开启/关闭指令输入' },
};

// ---------- 生成失败的分类 ----------
export const CHAT_ERRORS = {
  emptyResponse:        '⚠️ 生成失败，可能是网络波动或模型不稳定，请重试或换个模型试试',
  statusBlockOnly:      '⚠️ AI 只输出了状态栏，没有生成对话内容。可能是输出长度设定过短，或角色的状态栏配置有问题。',
  sendFailed:           '发送失败',
  regenerateFailed:     '重新生成失败',
  contentFilterBlocked: '⚠️ 生成遇到问题，建议重试或换个模型试试',
  streamInterrupted:    '⚠️ 回复生成被中断，可能是网络波动。已生成的部分已保留，请重试或换个模型试试。',
  upstreamError:        '⚠️ 模型服务暂时出错，这次没有生成内容，请重试或换个模型试试',
  modelForbidden:       '您目前无权使用此模型，请切换到其他模型。',
};

export const PAYWALL = {
  insufficientCreditsTitle:   '她还有好多话想对你说…',
  insufficientCreditsMessage: '充值继续你们的专属故事',
  goToTopUp:                  '继续我们的故事',
  goToTasks:                  '做任务免费领钻石',
  imageQuotaTitle:            '这一幕，她想画给你看',
  imageQuotaMessage:          '免费生图次数已用完，任意充值即可不限次数',
};
