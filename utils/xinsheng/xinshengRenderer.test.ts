// 渲染器的 **DOM 契约** 测试。
//
// 这份测试的意义不是「组件能渲染」，而是「糯叽机论坛上的心声美化贴到 Sully 里还能生效」。
// 那些美化是纯 CSS，靠的全是类名和层级关系；只要下面这些选择器还能选中东西，
// 别人的预设就能用。改动渲染器时这里挂了 = 你刚刚让所有论坛美化失效了。
//
// 样本取自实际在用的论坛美化「浅浅（蓝）· 拆分版」的布局，
// 断言的选择器取自它 CSS 里真正出现过的那些。

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { XinshengLayoutRenderer } from '../../components/chat/xinsheng/XinshengLayoutRenderer';
import { XINSHENG_DEFAULT_CSS } from './xinshengDefaultCss';
import { XINSHENG_TEMPLATES } from './xinshengTemplates';

/** 「浅浅（蓝）· 拆分版」的布局原文。 */
const FORUM_LAYOUT = `# 雾语蓝 - 渐变叠影论坛版
@particles rain 30

@collapse "Ⅱ ． 隙 间 白 噪" 2 .fadeInUp.delay100
@text talk1
@text talk2
@endcollapse

@collapse "Ⅰ ． 见 字 如 面" 1 .fadeInUp.delay200
@image letterImage
@text moodWord1
@quote letterConfession
@endcollapse

@collapse "Ⅲ ．  浮 生 瑣 記" 3 .fadeInUp.delay300
@list
memo1
memo2
@endcollapse

@collapse "Ⅳ ． 雾 境 坛 喧" 4
@text forum_post_1_name
@text forum_post_1
@text forum_reply_2_name
@text forum_reply_2
@endcollapse

@toggle 4`;

const FORUM_DATA = {
    talk1: '路人甲\n在吗',
    talk2: '雾语\n在的',
    letterImage: 'https://i.postimg.cc/x/y.jpg',
    letterConfession: '見字如面：今天想你了。',
    moodWord1: '烦',
    memo1: '买牛奶',
    memo2: '交方案',
    forum_post_1_name: '逃跑程序员',
    forum_post_1: '家人们，老板今天是不是被夺舍了',
    forum_reply_2_name: '雾语',
    forum_reply_2: '别问，问就是在研究天花板',
    mood: 'calm',
    affection: 82,
};

const render = (layout: string, data: any = FORUM_DATA, extra: any = {}) =>
    renderToStaticMarkup(createElement(XinshengLayoutRenderer, {
        layout,
        data,
        character: { name: '雾语', image: 'https://example.com/a.png' },
        userInfo: { name: '千夜', avatar: 'https://example.com/u.png' },
        ...extra,
    }));

describe('论坛美化的 DOM 契约', () => {
    const html = render(FORUM_LAYOUT);

    it('根节点是 .xt-root，内容包在 .xt-content 里', () => {
        expect(html).toContain('class="xt-root');
        expect(html).toContain('class="xt-content"');
    });

    it('8 个 checkbox 是 .xt-content 的前置兄弟 —— #xt-tN:checked ~ .xt-content 全靠这个', () => {
        for (let i = 1; i <= 8; i++) {
            expect(html).toContain(`id="xt-t${i}"`);
            expect(html).toContain(`class="xt-toggle xt-t${i}"`);
        }
        const lastToggle = html.lastIndexOf('id="xt-t8"');
        const content = html.indexOf('class="xt-content"');
        expect(lastToggle).toBeGreaterThan(-1);
        expect(content).toBeGreaterThan(lastToggle);
    });

    it('@collapse 产出 .xt-collapse-N / -header / -arrow / -body，label 指向对应 checkbox', () => {
        for (const n of [1, 2, 3, 4]) {
            expect(html).toContain(`xt-collapse xt-collapse-${n}`);
            expect(html).toContain(`for="xt-t${n}"`);
        }
        expect(html).toContain('class="xt-collapse-header"');
        expect(html).toContain('class="xt-collapse-arrow"');
        expect(html).toContain('class="xt-collapse-body"');
    });

    it('@text 带字段名类 .xt-text-{字段} —— 美化就是靠它把 talk1 画成聊天气泡', () => {
        for (const f of ['talk1', 'talk2', 'moodWord1', 'forum_post_1_name', 'forum_post_1', 'forum_reply_2_name', 'forum_reply_2']) {
            expect(html).toContain(`xt-text xt-text-${f}`);
        }
        expect(html).toContain('class="xt-text-content"');
    });

    it('@toggle 产出 .xt-action-N 的 label', () => {
        expect(html).toContain('xt-action xt-action-4');
    });

    it('@quote / @image / @particles 的类名齐全', () => {
        expect(html).toContain('class="xt-quote ');
        expect(html).toContain('xt-image xt-image-letterImage');
        expect(html).toContain('xt-particles xt-particles-rain');
    });

    it('@list 的子项**必须缩进**才归属它 —— 这份论坛布局没缩进，所以 memo1/memo2 是独立 @text', () => {
        // 不是我们的 bug，糯叽机同样如此（顶格的非 @ 行一律当成隐式 @text）。
        // 这条钉住行为：哪天「顺手」让不缩进也归属容器，这份美化的排版就全变了。
        expect(html).toContain('class="xt-list "');
        expect(html).not.toContain('class="xt-list-check"');
        expect(html).toContain('xt-text xt-text-memo1');
    });

    it('缩进的 @list 子项才渲染成勾选项', () => {
        const listed = render('@list\n  memo1\n  memo2', { memo1: '买牛奶', memo2: '交方案', memo1Done: true });
        expect(listed).toContain('class="xt-list-check"');
        expect(listed).toContain('class="xt-list-text"');
        expect(listed).toContain('xt-list-item xt-list-item-memo1 xt-list-item-on');
        expect(listed).toContain('xt-list-item xt-list-item-memo2"');
    });

    it('动画修饰符渲染成 xt-anim-*', () => {
        expect(html).toContain('xt-anim-fadeInUp');
        expect(html).toContain('xt-anim-delay100');
    });

    it('@particles 挂在 .xt-content **之外**（它是绝对定位的背景层）', () => {
        const particles = html.indexOf('xt-particles');
        const content = html.indexOf('class="xt-content"');
        expect(particles).toBeGreaterThan(-1);
        expect(particles).toBeLessThan(content);
    });

    it('内置默认 CSS 与自定义 CSS 都注入，且默认在前（自定义才能覆盖它）', () => {
        const withCss = render(FORUM_LAYOUT, FORUM_DATA, { customCss: '.xt-root{--xt-accent:#abc}' });
        const def = withCss.indexOf('心声布局模板默認 CSS');
        const custom = withCss.indexOf('--xt-accent:#abc');
        expect(def).toBeGreaterThan(-1);
        expect(custom).toBeGreaterThan(def);
    });
});

describe('数据驱动的 CSS 钩子', () => {
    it('数字字段变成 --xt-f-* 变量，文本字段变成 .xt-v-字段-值 类', () => {
        const html = render('@text mood', { mood: 'calm', affection: 82 });
        expect(html).toContain('--xt-f-affection:82');
        expect(html).toContain('xt-v-mood-calm');
    });

    it('非法键名（带点、中文）不生成变量或类名', () => {
        const html = render('@text a', { 'a.b': 1, '心情': 'x', a: 'ok' });
        expect(html).not.toContain('--xt-f-a.b');
        expect(html).not.toContain('xt-v-心情');
    });
});

describe('内建字段与系统变量', () => {
    it('charName / charImage / userName / userImage 由系统填充', () => {
        const html = render('@duo charImage charName userImage userName');
        expect(html).toContain('雾语');
        expect(html).toContain('千夜');
        expect(html).toContain('https://example.com/a.png');
        expect(html).toContain('https://example.com/u.png');
    });

    it('AI 输出覆盖系统变量（教程里承诺过的优先级）', () => {
        const html = renderToStaticMarkup(createElement(XinshengLayoutRenderer, {
            layout: '@text bondDays',
            data: { bondDays: '999' },
            systemData: { bondDays: '365' },
            character: { name: 'x' },
        }));
        expect(html).toContain('999');
        expect(html).not.toContain('365');
    });
});

describe('安全与容错', () => {
    it('@bg 只接受 http(s)/data:/blob: 开头的图片地址', () => {
        expect(render('@bg evil', { evil: 'javascript:alert(1)' })).not.toContain('javascript:');
        expect(render('@bg pic', { pic: 'https://example.com/b.png' })).toContain('background-image:url(&quot;https://example.com/b.png&quot;)');
    });

    it('@bg 的地址里带引号括号时被转义，不会闭合 url() 注入 CSS', () => {
        const html = render('@bg pic', { pic: 'https://e.com/a.png");}body{display:none' });
        expect(html).not.toContain('body{display:none');
    });

    it('空布局渲染成 null', () => {
        expect(render('')).toBe('');
        expect(render('# 只有注释')).toBe('');
    });

    it('字段缺失时不炸，只是空着', () => {
        expect(() => render('@bar nothing "无"\n@ring nothing\n@rating nothing')).not.toThrow();
    });

    it('@each 认字符串形式的数组', () => {
        const html = render('@each thoughts\n  @quote item\n@endeach', { thoughts: '["想靠近你","又有点怕"]' });
        expect(html).toContain('想靠近你');
        expect(html).toContain('又有点怕');
    });

    it('@if / @else 只渲染命中的那一支', () => {
        const hi = render('@if lv > 80\n@text a\n@else\n@text b\n@endif', { lv: 90, a: 'HIGH', b: 'LOW' });
        expect(hi).toContain('HIGH');
        expect(hi).not.toContain('LOW');
    });
});

describe('内置范例模板', () => {
    it('8 个都能渲染出内容，不抛异常', () => {
        expect(XINSHENG_TEMPLATES).toHaveLength(8);
        for (const t of XINSHENG_TEMPLATES) {
            const html = render(t.layout, { ...FORUM_DATA, innerVoice: 'x', emotionLevel: 70, moodTrend: [1, 2, 3], thoughts: ['a'] });
            expect(html, t.name).toContain('xt-root');
        }
    });
});

describe('内置默认 CSS', () => {
    it('论坛美化依赖的那几个变量与关键规则都在', () => {
        for (const token of ['--xt-bg', '--xt-text', '--xt-text-sub', '--xt-accent', '--xt-font', '--xt-radius']) {
            expect(XINSHENG_DEFAULT_CSS).toContain(token);
        }
        // 折叠是 checkbox hack 的地基：展开靠 :checked 把 max-height 撑开
        expect(XINSHENG_DEFAULT_CSS).toContain('.xt-collapse-body');
        expect(XINSHENG_DEFAULT_CSS).toContain(':checked');
        // 动画 keyframes 少一个，带该修饰符的美化就整块不动
        for (const kf of ['xt-fadeIn', 'xt-fadeInUp', 'xt-scaleIn', 'xt-shimmer', 'xt-scroll']) {
            expect(XINSHENG_DEFAULT_CSS).toContain(`@keyframes ${kf}`);
        }
    });
});
