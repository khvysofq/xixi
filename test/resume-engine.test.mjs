import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResume, docxXmlToText, pdfItemsToText, normalizeText } from '../tools-src/resume/extract.mjs';
import { professional, professionalText } from '../tools-src/resume/professional.mjs';
import { analyze, summary, ledgerText, ledgerOneLine, schoolTier } from '../tools-src/resume/match.mjs';

const NOW = '2026-11-23T00:00:00Z';

const RESUME = `张伟
男，29岁，电话:13812345678  邮箱：zhangwei@mail.com
求职意向:物流调度专员  现居:广州

教育背景
2014.09-2018.06  武汉理工大学  交通运输工程  本科（学士）

工作经历
2018.07-2021.03  广州风信物流有限公司  调度专员
- 负责珠三角干线车辆调度，日均协调车辆40台次
- 使用TMS系统排线，与司机、仓库对接装卸时间
- 通过优化配载，运输成本下降8%
2021.04-至今  顺丰同城物流集团  高级运力运营
- 管理3家承运商，月度结算对账，处理异常运单
- 搭建运力看板，用Excel透视表和SQL取数，周报输出准点率

技能证书
- 熟悉Excel（透视表、VLOOKUP），会用SQL取数
- 持有C1驾照，可出差
- 英语CET-6`;

const REQS = `3年以上物流调度经验
熟悉Excel，会SQL优先
本科及以上学历
有承运商管理或结算经验
英语能读邮件
年龄35岁以内`;

test('解析：基本信息/教育/履职/年限/技能全对上', () => {
  const r = parseResume(RESUME, { now: new Date(NOW) });
  assert.equal(r.name, '张伟');
  assert.equal(r.age, 29);
  assert.equal(r.phone, '13812345678');
  assert.equal(r.email, 'zhangwei@mail.com');
  assert.equal(r.school, '武汉理工大学');
  assert.equal(r.degree, '本科');
  assert.equal(r.major, '交通运输工程');
  assert.equal(r.jobs.length, 2, '两段履职');
  assert.equal(r.jobs[0].company, '广州风信物流有限公司');
  assert.equal(r.jobs[0].role, '调度专员');
  assert.equal(r.jobs[1].to, '至今');
  assert.ok(r.yearsTotal >= 8.2 && r.yearsTotal <= 8.5, '2018.07→2026.11 ≈ 8.3 年，got ' + r.yearsTotal);
  assert.ok(r.skills.some((x) => /excel/i.test(x)));
  assert.ok(r.skills.some((x) => /sql/i.test(x)));
});

test('匹配：物流调度岗 → 高匹配，逐条有证据', () => {
  const r = parseResume(RESUME, { now: new Date(NOW) });
  const a = analyze(r, REQS, { now: NOW });
  assert.ok(a.overall >= 80, 'overall=' + a.overall);
  assert.equal(a.verdict, '高匹配');
  const yearItem = a.items.find((x) => x.req.includes('3年'));
  assert.ok(yearItem.score >= 80, '年限够+物流调度领域也命中，got ' + yearItem.score);
  assert.ok(yearItem.evidence.includes('8.3') || yearItem.evidence.includes('8.2'), 'evidence=' + yearItem.evidence);
  const eng = a.items.find((x) => x.req.includes('英语'));
  assert.ok(eng.score >= 55, 'CET-6 该被同义词抓到，got ' + eng.score + ' ' + eng.evidence);
  assert.ok(a.items.every((x) => x.evidence), '每条都得有话说');
});

test('反例：会计简历投物流岗 → 低匹配，缺口点名', () => {
  const acc = `李静
女，31岁
求职意向：会计
2015.09-2019.06  河南财经政法大学  会计学  本科
工作经历
2019.07-至今  郑州诚信科技有限公司  会计
- 负责记账凭证、发票开具、月度报税
- 熟练使用用友U8、Excel
技能：初级会计职称、CPA两门`;
  const r = parseResume(acc, { now: new Date(NOW) });
  const a = analyze(r, REQS, { now: NOW });
  assert.ok(a.overall <= 60, 'overall=' + a.overall);
  const gap = a.items.find((x) => x.req.includes('调度') || x.req.includes('物流'));
  assert.ok(gap.score <= 40 || gap.evidence.includes('没出现'), '物流调度缺口要指出来');
});

test('总结：50~100 字硬区间', () => {
  const r = parseResume(RESUME, { now: new Date(NOW) });
  const a = analyze(r, REQS, { now: NOW });
  const s = summary(r, a);
  assert.ok(s.length >= 50 && s.length <= 100, '长度=' + s.length + '：' + s);
  assert.ok(s.includes('8.3') || s.includes('8.2'), '带年限');
  assert.ok(s.includes('武汉理工大学'), '带院校');
  assert.ok(s.includes('匹配'), '带结论');
  // 空简历也不能越界
  const empty = parseResume('', { now: new Date(NOW) });
  const s2 = summary(empty, analyze(empty, '本科', { now: NOW }));
  assert.ok(s2.length >= 50 && s2.length <= 100, '空档也守住区间：' + s2.length);
});

test('台账文字版：院校/每段履职时间齐、一行 tab 版可贴表格', () => {
  const r = parseResume(RESUME, { now: new Date(NOW) });
  const a = analyze(r, REQS, { now: NOW });
  const t = ledgerText(r, a);
  assert.ok(t.includes('武汉理工大学'), '毕业院校');
  assert.ok(t.includes('2018.07-2021.03'), '第一段履职时间');
  assert.ok(t.includes('2021.04-至今'), '第二段至今');
  assert.ok(t.includes('广州风信物流有限公司') && t.includes('顺丰同城物流集团'), '公司名都在');
  assert.ok(t.includes('调度专员') && t.includes('高级运力运营'), '职位都在');
  const one = ledgerOneLine(r, a);
  assert.equal(one.split('\t').length, 7, '七个字段');
  assert.ok(one.includes('2018.07-2021.03'));
});

test('日期格式变体：2018年3月-2020年1月 / 2018/3~至今 / 全角', () => {
  const r = parseResume(normalizeText(`
2018年3月-2020年1月  北京华夏物流公司  仓管员
2020/3~至今  上海速达快递有限公司  调度专员
`), { now: new Date(NOW) });
  assert.equal(r.jobs.length, 2);
  assert.equal(r.jobs[0].from, '2018.03');
  assert.equal(r.jobs[0].to, '2020.01');
  assert.equal(r.jobs[1].to, '至今');
  assert.ok(r.yearsTotal >= 6.6, '2018.3→2026.11 ≈ 6.7 年，got ' + r.yearsTotal);
});

test('权重语法：30% 前缀与 |50 后缀都吃', () => {
  const r = parseResume(RESUME, { now: new Date(NOW) });
  const a = analyze(r, '50% 会SQL\n会Excel|50', { now: NOW });
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].weight, 50);
  assert.equal(a.items[1].weight, 50);
  assert.equal(a.items[0].req, '会SQL');
});

test('985/211 名单与 docx/pdf 转换函数', () => {
  assert.equal(schoolTier('武汉大学'), '985');
  assert.equal(schoolTier('武汉理工大学'), '211');
  assert.equal(schoolTier('北京邮电大学'), '211');
  assert.equal(schoolTier('深圳大学'), '', '深大不是211，别乱给');
  assert.equal(schoolTier('某某师范学院'), '');
  const xml = '<w:document><w:body><w:p><w:r><w:t>张伟</w:t></w:r></w:p><w:p><w:r><w:t>电话&#65306;13800000000</w:t></w:r></w:p></w:body></w:document>';
  const txt = docxXmlToText(xml);
  assert.ok(txt.includes('张伟\n') || txt.includes('张伟'), '段落换行');
  assert.ok(txt.includes('电话：13800000000'), '全角冒号实体解码');
  const items = [
    { str: '2018.07-2021.03', transform: [1, 0, 0, 1, 0, 750] },
    { str: ' 广州风信物流有限公司', transform: [1, 0, 0, 1, 120, 750] },
    { str: '调度专员', transform: [1, 0, 0, 1, 0, 730] },
  ];
  const t2 = pdfItemsToText(items);
  assert.ok(t2.includes('2018.07-2021.03 广州风信物流有限公司\n调度专员'), '同行拼接、跨行断开：' + JSON.stringify(t2));
});

test('识别不了也别编：空白简历全零但结构完整', () => {
  const r = parseResume('随便几句\n没有日期没有学校\n就是废话', { now: new Date(NOW) });
  assert.equal(r.school, '');
  assert.equal(r.jobs.length, 0);
  assert.equal(r.yearsTotal, null);
  const a = analyze(r, '本科及以上', { now: NOW });
  assert.ok(a.overall <= 20, '没学历就该低分');
});

test('真机冒烟带回的坑：角色不串段、证据不空转、节标题不进技能', () => {
  const TWO = `赵敏
女，28岁
电话：13612345678

教育背景
2015.09-2019.06 湖南大学 会计学 本科（学士）

工作经历
2019.07-2022.05 深圳市恒达贸易有限公司 会计
- 负责全盘账务处理与纳税申报
2022.06-至今 跨越速运集团有限公司 财务专员
- 负责应收应付对账与月度结算报表

技能证书
熟练Excel（VLOOKUP、数据透视表），会用友、金蝶财务软件，英语CET-6`;
  const r = parseResume(TWO, { now: new Date(NOW) });
  assert.equal(r.jobs[0].role, '会计', '第一段职位别被第二段的“财务专员”污染');
  assert.equal(r.jobs[1].role, '财务专员');
  assert.ok(!r.skills.includes('技能证书'), '节标题不算技能');
  const a2 = analyze(r, '细致、能承受结账期高强度工作', { now: NOW });
  assert.ok(!a2.items[0].evidence.includes('「」'), 'evidence 不许空括号：' + a2.items[0].evidence);
  assert.ok(a2.items[0].evidence.length > 6, a2.items[0].evidence);
  const a3 = analyze(r, '熟练使用Excel，会用友或金蝶优先', { now: NOW });
  assert.ok(a3.items[0].score >= 75 && !a3.items[0].evidence.includes('「」'), a3.items[0].evidence);
});

test('猎聘导出格式：公司名无后缀、职位独立行、职责业绩长文、显式时长', () => {
  const LP = `刘经理
男，35岁
电话：13800001111

教育背景
2009.09-2013.06 上海大学 工商管理 本科（学士）

工作经历
中海商业上海环宇城 MAX\t2023.04-至今（3年6个月）
高级招商经理
所在部门：\t汇报对象：
职责业绩：【项目经历】32万方上海真如环宇城MAX购物中心（2023.12开业），2025年销售上海TOP8-62亿，参与筹备开业招商及运营期全业态招商工作
【2023筹备期招商】筹备期集中签约品牌百余个，其中引进首店品牌50余个
龙湖天街购物中心\t2020.06-2023.03（2年9个月）
招商主管
职责业绩：负责华东区两家天街零售业态招商，累计签约品牌300+`;
  const r = parseResume(LP, { now: new Date(NOW) });
  assert.equal(r.jobs.length, 2);
  assert.equal(r.jobs[0].company, '中海商业上海环宇城 MAX', '无“公司”后缀也要拿到抬头');
  assert.equal(r.jobs[0].role, '高级招商经理');
  assert.equal(r.jobs[1].role, '招商主管');
  assert.ok(r.jobs[0].desc.length >= 2, '职责业绩+【】行都要进描述：' + r.jobs[0].desc.length);
  assert.equal(r.yearsTotal, 6.3, '3年6个月+2年9个月=6.3：' + r.yearsTotal);
  const a = analyze(r, '3年以上商业地产招商经验\n有购物中心筹备期开业招商案例', { now: NOW });
  assert.ok(a.overall >= 70, '招商岗对招商人 overall=' + a.overall);
});

test('PDF 分列拆行：公司名行 + 纯日期行要合并成一段', () => {
  const SPLIT = `工作经历
中海商业上海环宇城 MAX
2023.04-至今（3年6个月）
高级招商经理
职责业绩：【项目经历】负责购物中心全业态招商与品牌落位管理`;
  const r = parseResume(SPLIT, { now: new Date(NOW) });
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].company, '中海商业上海环宇城 MAX');
  assert.equal(r.jobs[0].role, '高级招商经理');
  assert.equal(r.jobs[0].dur, 3.5);
});

test('pdf 乱序 items：写入顺序颠倒也能拼回正确行', () => {
  const scrambled = [
    { str: '高级招商经理', transform: [1, 0, 0, 1, 60, 700] },
    { str: '2023.04-至今（3年6个月）', transform: [1, 0, 0, 1, 420, 752] },
    { str: '中海商业上海环宇城 MAX', transform: [1, 0, 0, 1, 60, 750] },
  ];
  const t = pdfItemsToText(scrambled);
  assert.ok(t.includes('中海商业上海环宇城 MAX 2023.04-至今（3年6个月）'), '同行按 x 排：' + JSON.stringify(t));
  const r = parseResume('工作经历\n' + t, { now: new Date(NOW) });
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].company, '中海商业上海环宇城 MAX');
  assert.equal(r.jobs[0].role, '高级招商经理');
});

test('大悦城段（主人第二张截图）：控股系无后缀公司、全角破折号、职责业绩带前导空格', () => {
  const DC = `工作经历
大悦城控股上海长风大悦城 2021.03－2023.04（2年1个月）
招商经理
所在部门： 汇报对象：
职责业绩： 负责项目零售业态招商，代理招商负责人，引入多家上海首店、区域首店；
【专项工作】项目年度招商目标制定及预算编制工作；主责招商调改报告、经营分析报告撰写等；
【管理角色】零售业态组招商组长，组员2人，完成项目核心户外运动零售区招商调改工作；部门成员4人，完成项目LG层超市区改造及招商升级工作。
【公司表彰与晋升】集团3040总监班储备人才；获得职位晋升一次。`;
  const r = parseResume(DC, { now: new Date(NOW) });
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].company, '大悦城控股上海长风大悦城');
  assert.equal(r.jobs[0].role, '招商经理');
  assert.equal(r.jobs[0].from, '2021.03');
  assert.equal(r.jobs[0].to, '2023.04');
  assert.equal(r.yearsTotal, 2.1, '2年1个月：' + r.yearsTotal);
  assert.ok(r.jobs[0].desc.length >= 3, '职责业绩+【】行：' + r.jobs[0].desc.length);
  const a = analyze(r, '3年以上商业地产招商经验\n带过团队|25', { now: NOW });
  const team = a.items.find((x) => x.req.includes('带过团队'));
  assert.ok(team.score >= 55, '“招商组长，组员2人”应算带团队：' + team.score + ' ' + team.evidence);
});

const FULL_LP = `刘经理
男，35岁
电话：13800001111

教育背景
2009.09-2013.06 上海大学 工商管理 本科（学士）

工作经历
中海商业上海环宇城 MAX\t2023.04-至今（3年6个月）
高级招商经理
职责业绩：【项目经历】32万方上海真如环宇城MAX购物中心（2023.12开业），2025年销售上海TOP8-62亿，参与筹备开业招商及运营期全业态招商工作
【2023筹备期招商】筹备期集中签约品牌百余个，其中引进首店品牌50余个
大悦城控股上海长风大悦城\t2021.03－2023.04（2年1个月）
招商经理
职责业绩： 负责项目零售业态招商，代理招商负责人，引入多家上海首店、区域首店；
【管理角色】零售业态组招商组长，组员2人；作为项目代理招商负责人统筹招商工作，部门成员4人
龙湖天街购物中心\t2020.06-2023.03（2年9个月）
招商主管
职责业绩：负责华东区两家天街零售业态招商，累计签约品牌300+，空置率从8%压到3%`;

test('专业意见：同一简历两个岗位要求的分野（主人原话场景）', () => {
  const r = parseResume(FULL_LP, { now: new Date(NOW) });
  const p1 = professional(r, '5年左右高级招商经理', analyze(r, '5年左右高级招商经理', { now: NOW }));
  assert.equal(p1.level, 'mid');
  assert.equal(p1.industry, '商业地产招商');
  assert.equal(p1.gaps.length, 0, '高级经理岗不该挑出硬短板：' + JSON.stringify(p1.gaps));
  assert.ok(p1.bizAdvice.includes('直接接盘子'), p1.bizAdvice);

  const p2 = professional(r, '已带团队的招商负责人', analyze(r, '已带团队的招商负责人', { now: NOW }));
  assert.equal(p2.level, 'mgmt');
  assert.ok(p2.gaps.some((g) => g.includes('管理') && g.includes('代理')), '管理量级短板：' + JSON.stringify(p2.gaps));
  assert.ok(p2.gaps.some((g) => g.includes('横向')), '横向沟通短板：' + JSON.stringify(p2.gaps));
  assert.ok(p2.hrAdvice.includes('优等生'), p2.hrAdvice);
  assert.ok(p2.bizAdvice.includes('将') && p2.bizAdvice.includes('帅'), p2.bizAdvice);
  const txt = professionalText(p2);
  assert.ok(txt.includes('【专业意见】') && txt.includes('短板') && txt.includes('人力视角'), txt.slice(0, 120));
});
