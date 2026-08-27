import { describe, it, expect } from 'vitest';
import { parseLayout, parseDirective, splitArgs, validateLayout, type XinshengNode, type XinshengChild } from './xinshengLayout';

const nodes = (src: string) => parseLayout(src) as XinshengNode[];

describe('splitArgs', () => {
    it('引号内的空格不切', () => {
        expect(splitArgs('emotionLevel "情绪 指数"')).toEqual(['emotionLevel', '情绪 指数']);
    });

    it('空引号也占一个位次（@badge x "" 的后缀）', () => {
        expect(splitArgs('x ""')).toEqual(['x', '']);
    });

    it('裸词紧贴开引号时会被切开（糯叽机的宽容行为，美化里靠它兜漏空格）', () => {
        expect(splitArgs('mood"心情"')).toEqual(['mood', '心情']);
    });
});

describe('parseDirective', () => {
    it('@header 缺参数时回落到 charImage / charName', () => {
        expect(parseDirective('@header')).toMatchObject({ type: 'header', imageField: 'charImage', nameField: 'charName' });
    });

    it('尾部动画修饰符被摘成 anims', () => {
        expect(parseDirective('@badge bondDays "天" .scaleIn.delay200')).toMatchObject({
            type: 'badge', field: 'bondDays', suffix: '天', anims: ['scaleIn', 'delay200'],
        });
    });

    it('字段名里的点不会被当成动画', () => {
        expect(parseDirective('@text item.name')).toMatchObject({ type: 'text', field: 'item.name', anims: [] });
    });

    it('指令名大小写与连字符都归一化', () => {
        expect(parseDirective('@Duo-Header')).toMatchObject({ type: 'duo' });
        expect(parseDirective('@KEYVALUE')).toMatchObject({ type: 'kv' });
    });

    it('@grid / @row 列数封顶 6，@toggle 封顶 8', () => {
        expect(parseDirective('@grid 99')).toMatchObject({ columns: 6 });
        expect(parseDirective('@row 99')).toMatchObject({ columns: 6 });
        expect(parseDirective('@toggle 99')).toMatchObject({ index: 8 });
        expect(parseDirective('@toggle 0')).toMatchObject({ index: 1 });
    });

    it('@particles 的参数无序：数字=数量，字母=效果，其它=自订字元', () => {
        expect(parseDirective('@particles sakura 20')).toMatchObject({ effect: 'sakura', count: 20, char: '' });
        expect(parseDirective('@particles 14 "✧"')).toMatchObject({ effect: 'emoji', count: 14, char: '✧' });
        expect(parseDirective('@particles snow 999')).toMatchObject({ count: 50 });
    });

    it('@if 支持 between 与 and/or 多条件', () => {
        expect(parseDirective('@if moodLevel between 40 70')).toMatchObject({
            type: 'conditional',
            conds: [{ field: 'moodLevel', op: 'between', value: '40', value2: '70' }],
            joiner: 'and',
        });
        const or = parseDirective('@if a > 1 or b contains x') as XinshengNode;
        expect(or.joiner).toBe('or');
        expect(or.conds).toHaveLength(2);
    });

    it('认不出的指令返回 null（整行丢弃，不炸）', () => {
        expect(parseDirective('@nonsense foo')).toBeNull();
    });
});

describe('parseLayout', () => {
    it('缩进行归属上方最近的行内容器', () => {
        const tree = nodes('@section 内心独白\n  innerVoice\n  statusText');
        expect(tree).toHaveLength(1);
        expect(tree[0].type).toBe('section');
        expect(tree[0].children as XinshengChild[]).toEqual([{ field: 'innerVoice' }, { field: 'statusText' }]);
    });

    it('@grid 的子行拆成 字段:类型 "标签"', () => {
        const tree = nodes('@grid 3\n  emotionLevel:bar "情绪"\n  mood');
        expect(tree[0].children).toEqual([
            { field: 'emotionLevel', subtype: 'bar', label: '情绪' },
            { field: 'mood', subtype: 'stat', label: '' },
        ]);
    });

    it('@row / @card 嵌套，@endcard / @endrow 逐层收口', () => {
        const tree = nodes('@row 2\n@card "左"\n@text a\n@endcard\n@card "右"\n@text b\n@endcard\n@endrow\n@footer END');
        expect(tree.map(n => n.type)).toEqual(['row', 'footer']);
        const row = tree[0];
        const cards = row.children as XinshengNode[];
        expect(cards.map(c => c.type)).toEqual(['card', 'card']);
        expect((cards[0].children as XinshengNode[])[0]).toMatchObject({ type: 'text', field: 'a' });
    });

    it('@if / @else 分流到 children / elseChildren', () => {
        const tree = nodes('@if emotionLevel > 80\n@text high\n@else\n@text low\n@endif');
        const cond = tree[0];
        expect((cond.children as XinshengNode[])[0]).toMatchObject({ field: 'high' });
        expect((cond.elseChildren as XinshengNode[])[0]).toMatchObject({ field: 'low' });
    });

    it('注释行与空行被忽略；顶格裸文本当作 @text', () => {
        const tree = nodes('# 这是注释\n\ninnerVoice');
        expect(tree).toEqual([{ type: 'text', field: 'innerVoice', anims: [] }]);
    });

    it('多余的 @end 不会炸，只是空操作', () => {
        expect(() => nodes('@endcard\n@endrow\n@text a')).not.toThrow();
        expect(nodes('@endcard\n@text a')).toHaveLength(1);
    });

    it('@kv 三种写法都能拆出 键 / 字段', () => {
        const tree = nodes('@kv\n  好感度 : affection\n  "当前心情" mood\n  energy');
        expect(tree[0].children).toEqual([
            { key: '好感度', field: 'affection' },
            { key: '当前心情', field: 'mood' },
            { key: 'energy', field: 'energy' },
        ]);
    });

    it('@timeline / @table 按 | 拆单元格，引号内是固定文字', () => {
        const tl = nodes('@timeline\n  "08:00" | wakeUp');
        expect((tl[0].children as XinshengChild[])[0].segs).toEqual([{ literal: '08:00' }, { field: 'wakeUp' }]);
        const tb = nodes('@table\n  "项目" | "值"');
        expect((tb[0].children as XinshengChild[])[0].cells).toEqual([{ literal: '项目' }, { literal: '值' }]);
    });

    it('空输入 / 非字符串返回空数组', () => {
        expect(parseLayout('')).toEqual([]);
        expect(parseLayout(undefined as any)).toEqual([]);
    });
});

describe('validateLayout', () => {
    it('合法布局没有报错', () => {
        expect(validateLayout('@header charImage charName\n  innerVoice\n# 注释')).toEqual([]);
    });

    it('未知指令报出行号', () => {
        const errs = validateLayout('@header\n@nope');
        expect(errs).toHaveLength(1);
        expect(errs[0]).toContain('第 2 行');
    });
});
