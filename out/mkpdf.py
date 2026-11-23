# 手写最小 PDF：两页文本，pdf.js 可解析
lines1=["Wang Fang  WangFang","Female, 27 years old","Tel: 13700001234","Expected position: Financial Accounting","Education 2016.09-2020.06 Huazhong University of Science and Technology Accounting Undergraduate","Work Experience 2020.07-2023.06 Wuhan Zhonghe Accounting Firm Audit Assistant","- Responsible for inventory counting and working paper organization","2023.07-Present Shenzhen Lanhai Supply Chain Co., Ltd. Accountant","- Responsible for accounts receivable/payable reconciliation and monthly settlement reports"]
def esc(s): return s.replace('\\',r'\\').replace('(',r'\(').replace(')',r'\)')
def page(stream, x):
    content="BT /F1 12 Tf 50 %d Td "%x
    for L in stream.splitlines():
        content+="(%s) Tj 0 -18 Td "%esc(L)
    content+="ET"
    return content, len(content)
objs=[]
def build(pages):
    n=len(pages)*2+4
    out=[]
    out.append(b"%PDF-1.4\n")
    offs=[]
    def add(body):
        offs.append(len(b''.join(out)))
        out.append(body)
    cat_children=b" ".join(str(i+2).encode()+b" 0 R" for i in range(len(pages)))
    add(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    add(("2 0 obj\n<< /Type /Pages /Kids ["+cat_children.decode()+b"] /Count "+str(len(pages)).encode()+b" >>\nendobj\n") if False else ("2 0 obj\n<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n"%(" ".join("%d 0 R"%(3+i*2) for i in range(len(pages))),len(pages))).encode())
    for i,txt in enumerate(pages):
        c,ln=build_content(txt)
        add(("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\n" % () ).replace(b"3 0 obj",("%d 0 obj"%(3+i*2)).encode()).replace(b"4 0 R",("%d 0 R"%(4+i*2)).encode()))
        add(("%d 0 obj\n<< /Length %d >>\nstream\n"% (4+i*2, ln)).encode()+c.encode()+b"\nendstream\nendobj\n")
    add(b"%d 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"%(3+len(pages)*2))
    body=b''.join(out)
    xref=["xref\n0 %d\n"%(len(offs)+2),"0000000000 65535 f \n"]
    for o in offs: xref.append("%010d 00000 n \n"%o)
    xref.append("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"%(len(offs)+2,len(body)))
    return body+"".join(xref).encode()
def build_content(lines):
    content="BT /F1 12 Tf 50 740 Td "
    for L in lines:
        content+="(%s) Tj 0 -18 Td "%esc(L)
    content+="ET"
    return content,len(content)
data=build([lines1])
open('out/smoke.pdf','wb').write(data)
import base64
print(len(data), 'bytes; b64 len', len(base64.b64encode(data)))
