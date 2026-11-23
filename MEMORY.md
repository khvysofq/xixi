

- 2026-11-23 简历速看上线（/tools/resume-check/）：纯前端 PDF/DOCX/TXT 解析+岗位加权匹配+50~100字总结+台账两版；引擎 tools-src/resume/{extract,match}.mjs，测试 17 条，npm test 186 全绿。jsdom 坑：FileReader 结果跨 realm、JSZip 3 依赖 setImmediate、pdf.js UMD 不能在 Node require。
