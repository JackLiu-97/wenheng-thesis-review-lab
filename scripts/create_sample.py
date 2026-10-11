from pathlib import Path
import json, textwrap
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
import pypdfium2 as pdfium

root=Path(__file__).resolve().parents[1]
assets=root/'data'/'samples'; assets.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
W,H=595,842
c=canvas.Canvas(str(assets/'sample-paper.pdf'),pagesize=(W,H))
pages=[
('研究背景与相关工作',[
('面向学术论文的多智能体辅助评审方法','本文件为界面演示专门编写的虚构论文，所有数据、方法和结论均为示例，不可作为研究证据引用。'),
('摘要','本文探索多智能体在学术论文辅助评审中的应用，设计包含文档解析、分维度审阅与意见汇总的工作流程。系统尝试通过角色分工提高审阅覆盖度，并将评审意见与原文片段建立关联。'),
('1 研究背景与问题定义','现有自动评审系统仍然存在证据追溯困难、长文本理解不稳定等问题。本研究提出多角色协作方法，尝试帮助研究者发现论文中的潜在不足。'),
('1.1 研究目标','本文希望提高论文评审的质量与效率，并为研究人员提供全面、客观的反馈。系统应能够生成清晰的评审意见，帮助作者改进论文。'),
('2 相关研究','相关研究主要包括基于语言模型的文本评价、信息检索和多智能体协作。现有方法通常从内容完整性、研究方法和表达规范等角度分析论文。'),
('2.1 文献综述','本文按文本评价、检索增强、多智能体协作三个主题介绍相关工作，分别概述各类方法的技术路线及应用场景。不同方法的评价条件和适用边界尚未进行统一比较。')]),
('方法设计与实验分析',[
('3 多智能体评审框架','系统由文档解析器、六个维度审阅器和汇总模块组成。各审阅器读取论文内容，独立生成意见；汇总模块合并重复问题并输出报告。'),
('3.1 方法创新','本文的主要创新在于引入多个评审角色，并通过统一的提示词模板完成分维度评价。相较于单个语言模型，多个角色能够提供不同角度的反馈。'),
('3.2 证据关联','每条意见保存证据文本和对应的文档位置。系统使用文本块标识关联原文，供用户回看和核验。无法找到明确证据时，应标记为待核实。'),
('4 实验设置','实验选取 20 篇示例论文，将单角色方法与多角色方法进行比较。所有方法使用相同的基础模型，评审质量由人工对输出进行定性评价。'),
('4.1 工作量与实验覆盖','本文完成了框架实现以及一次整体性能比较。当前实验未包含单独移除角色、变更提示词和调整上下文长度等设置。'),
('4.2 结果讨论','多角色方法在示例论文中发现了更多问题，因此证明该方法能够在所有学科论文上稳定提高评审准确性，并具有普遍适用性。')]),
('研究价值与论文规范',[
('5 应用价值','该系统旨在辅助研究者开展投稿前自查，并支持评审提示词的持续调整。意见与原文关联能够帮助用户判断问题是否成立，减少反复查找原文的时间。'),
('5.1 局限与后续工作','后续将扩展样本规模、引入多学科论文并补充人工标注。目前输出仍依赖模型能力，需要人工审核后使用。'),
('6 结论','本文展示了一个多角色辅助评审框架，将文档解析、分维度评价与证据定位整合为一个工作流程。该探索为人机协作评审提供了可交互的实现思路。'),
('6.1 格式与术语','正文交替使用“评审准确率”“意见准确度”和“评价正确率”描述结果，未给出三个术语各自的定义及计算方式。'),
('参考文献说明','本演示文档没有列出真实参考文献，以免将虚构论文或占位信息误认为真实文献。正式系统应从上传论文中提取引用信息并独立核验。')])]
anchors={}; labels=[]
for page,(label,sections) in enumerate(pages,1):
    labels.append(label)
    c.setFillColorRGB(.38,.44,.46); c.setFont('STSong-Light',9)
    c.drawString(48,H-36,'REVIEW STUDIO  /  虚构演示论文'); c.drawRightString(W-48,H-36,f'{page:02d}')
    c.setStrokeColorRGB(.83,.86,.86); c.line(48,H-46,W-48,H-46)
    y=H-78
    for idx,(title,body) in enumerate(sections):
        c.setFillColorRGB(.10,.15,.17); c.setFont('STSong-Light',15 if idx==0 else 12)
        c.drawString(48,y,title); y-=25
        top=y-12
        lines=textwrap.wrap(body,40)
        c.setFont('STSong-Light',11); c.setFillColorRGB(.25,.29,.31)
        for line in lines: c.drawString(48,y,line); y-=20
        anchors[f'p{page}-{idx}']={'page':page,'x':46/W*100,'y':(H-(top+24))/H*100,'w':503/W*100,'h':(len(lines)*20+8)/H*100,'quote':body}
        y-=24
    c.setFont('STSong-Light',9); c.drawCentredString(W/2,30,'仅用于产品交互演示 · 非真实研究成果')
    c.showPage()
c.save()
doc=pdfium.PdfDocument(str(assets/'sample-paper.pdf'))
for i in range(len(doc)): doc[i].render(scale=1.8).to_pil().save(assets/f'page-{i+1}.png')
(assets/'document.json').write_text(json.dumps({'pages':labels,'anchors':anchors},ensure_ascii=False),encoding='utf-8')
print('Created 3-page sample PDF, rendered previews and evidence coordinates.')
