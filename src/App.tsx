import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera, Check, ChevronLeft, ChevronRight, Combine, Download, FileSpreadsheet,
  FileText, FileType2, ImagePlus, Images, Laptop, LoaderCircle, MoreHorizontal,
  Plus, Presentation, RotateCw, ScanLine, Scissors, Search, Share, Smartphone,
  Sparkles, Trash2, Type, Wrench, X
} from 'lucide-react'
import type { ScanDocument, ScanFilter, ScanPage } from './types'
import { deleteDocument, listDocuments, saveDocument } from './lib/db'
import { applyFilter, preparePage, rotatePage } from './lib/image'

const newTitle = () => `扫描文档 ${new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date())}`

type ToolId = 'merge-pdf' | 'split-pdf' | 'pdf-images' | 'pdf-word' | 'pdf-excel' | 'ppt-word'

export default function App() {
  const [documents, setDocuments] = useState<ScanDocument[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [busy, setBusy] = useState<string | null>('正在打开文档库…')
  const [search, setSearch] = useState('')
  const [ocrProgress, setOcrProgress] = useState<number | null>(null)
  const [textOpen, setTextOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [pendingTool, setPendingTool] = useState<ToolId | null>(null)
  const [toolAccept, setToolAccept] = useState('.pdf,application/pdf')
  const [toolMultiple, setToolMultiple] = useState(false)
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const toolInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listDocuments().then(setDocuments).finally(() => setBusy(null))
  }, [])

  const selected = documents.find(document => document.id === selectedId) ?? null
  const page = selected?.pages[pageIndex] ?? null
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return documents
    return documents.filter(document =>
      document.title.toLocaleLowerCase().includes(query) ||
      document.pages.some(item => item.ocrText.toLocaleLowerCase().includes(query))
    )
  }, [documents, search])

  async function persist(document: ScanDocument) {
    const updated = { ...document, updatedAt: Date.now() }
    setDocuments(current => [updated, ...current.filter(item => item.id !== updated.id)])
    await saveDocument(updated)
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(`正在处理 1/${files.length} 页…`)
    try {
      const pages: ScanPage[] = []
      for (let i = 0; i < files.length; i++) {
        setBusy(`正在处理 ${i + 1}/${files.length} 页…`)
        pages.push(await preparePage(files[i]))
      }
      if (selected) {
        const updated = { ...selected, pages: [...selected.pages, ...pages] }
        await persist(updated)
        setPageIndex(updated.pages.length - pages.length)
      } else {
        const now = Date.now()
        const document: ScanDocument = { id: crypto.randomUUID(), title: newTitle(), createdAt: now, updatedAt: now, pages }
        await persist(document)
        setSelectedId(document.id)
        setPageIndex(0)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '图片处理失败')
    } finally {
      setBusy(null)
      if (cameraInput.current) cameraInput.current.value = ''
      if (libraryInput.current) libraryInput.current.value = ''
    }
  }

  async function updatePage(transform: (page: ScanPage) => Promise<ScanPage>) {
    if (!selected || !page) return
    setBusy('正在优化页面…')
    try {
      const next = await transform(page)
      const pages = selected.pages.map((item, index) => index === pageIndex ? next : item)
      await persist({ ...selected, pages })
    } finally {
      setBusy(null)
    }
  }

  async function runOcr() {
    if (!selected || !page) return
    setOcrProgress(0)
    try {
      const { recognizeText } = await import('./lib/ocr')
      const ocrText = await recognizeText(page.dataUrl, setOcrProgress)
      const pages = selected.pages.map((item, index) => index === pageIndex ? { ...item, ocrText } : item)
      await persist({ ...selected, pages })
      setTextOpen(true)
    } catch (error) {
      alert(`文字识别失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setOcrProgress(null)
    }
  }

  async function removePage() {
    if (!selected || !page || !confirm('删除这一页？')) return
    const pages = selected.pages.filter((_, index) => index !== pageIndex)
    if (!pages.length) {
      await removeDocument(selected.id)
      return
    }
    await persist({ ...selected, pages })
    setPageIndex(index => Math.min(index, pages.length - 1))
  }

  async function removeDocument(id: string) {
    if (documents.find(item => item.id === id)?.pages.length && !confirm('删除整份文档？此操作无法撤销。')) return
    await deleteDocument(id)
    setDocuments(current => current.filter(item => item.id !== id))
    setSelectedId(null)
    setPageIndex(0)
  }

  async function exportPdf() {
    if (!selected) return
    setBusy('正在生成 PDF…')
    try {
      const { sharePdf } = await import('./lib/pdf')
      await sharePdf(selected)
    }
    catch (error) { alert(error instanceof Error ? error.message : 'PDF 导出失败') }
    finally { setBusy(null) }
  }

  async function exportWord() {
    if (!selected) return
    setBusy('正在生成 Word…')
    try {
      const { scanToWord } = await import('./lib/fileTools')
      await scanToWord(selected)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Word 导出失败')
    } finally {
      setBusy(null)
    }
  }

  async function runAllOcr() {
    if (!selected) return
    setOcrProgress(0)
    try {
      const { recognizeText } = await import('./lib/ocr')
      const pages = [...selected.pages]
      for (let index = 0; index < pages.length; index++) {
        if (!pages[index].ocrText.trim()) {
          const ocrText = await recognizeText(pages[index].dataUrl, progress => setOcrProgress((index + progress) / pages.length))
          pages[index] = { ...pages[index], ocrText }
        }
        setOcrProgress((index + 1) / pages.length)
      }
      await persist({ ...selected, pages })
      alert('全文识别已完成，现在可以导出可编辑 Word。')
    } catch (error) {
      alert(`全文识别失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setOcrProgress(null)
    }
  }

  function chooseTool(tool: ToolId, accept = '.pdf,application/pdf', multiple = false) {
    setPendingTool(tool)
    setToolAccept(accept)
    setToolMultiple(multiple)
    requestAnimationFrame(() => toolInput.current?.click())
  }

  async function handleToolFiles(files: FileList | null) {
    if (!files?.length || !pendingTool) return
    const selectedFiles = Array.from(files)
    const labels: Record<ToolId, string> = {
      'merge-pdf': '正在合并 PDF…',
      'split-pdf': '正在拆分 PDF…',
      'pdf-images': '正在转换 PDF 页面…',
      'pdf-word': '正在提取 PDF 文字…',
      'pdf-excel': '正在识别 PDF 表格…',
      'ppt-word': '正在提取 PPT 内容…'
    }
    setBusy(labels[pendingTool])
    try {
      const tools = await import('./lib/fileTools')
      const updateProgress = (label: string) => setBusy(label)
      if (pendingTool === 'merge-pdf') await tools.mergePdfs(selectedFiles)
      if (pendingTool === 'split-pdf') await tools.splitPdf(selectedFiles[0])
      if (pendingTool === 'pdf-images') await tools.pdfToImages(selectedFiles[0], updateProgress)
      if (pendingTool === 'pdf-word') await tools.pdfToWord(selectedFiles[0], updateProgress)
      if (pendingTool === 'pdf-excel') await tools.pdfToExcel(selectedFiles[0], updateProgress)
      if (pendingTool === 'ppt-word') await tools.pptToWord(selectedFiles[0], updateProgress)
    } catch (error) {
      alert(`转换失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setBusy(null)
      setPendingTool(null)
      if (toolInput.current) toolInput.current.value = ''
    }
  }

  return (
    <div className="app-shell">
      <input ref={cameraInput} className="hidden-input" type="file" accept="image/*" capture="environment" multiple onChange={event => importFiles(event.target.files)} />
      <input ref={libraryInput} className="hidden-input" type="file" accept="image/*" multiple onChange={event => importFiles(event.target.files)} />
      <input ref={toolInput} className="hidden-input" type="file" accept={toolAccept} multiple={toolMultiple} onChange={event => handleToolFiles(event.target.files)} />

      <header className="topbar">
        <button className="brand" onClick={() => setSelectedId(null)} aria-label="返回文档列表">
          <span className="brand-mark"><ScanLine size={22} /></span>
          <span><b>文镜</b><small>本地智能扫描</small></span>
        </button>
        <div className="topbar-actions">
          <button className="install-button" onClick={() => setToolsOpen(true)}><Wrench size={15} /> 文档工具箱</button>
          <button className="install-button" onClick={() => setInstallOpen(true)}><Download size={15} /> 安装到设备</button>
          <div className="privacy-chip"><span /> 仅存此设备</div>
        </div>
      </header>

      {selected ? (
        <main className="editor">
          <section className="editor-head">
            <button className="icon-button back" onClick={() => setSelectedId(null)}><ChevronLeft /></button>
            <input
              className="title-input"
              value={selected.title}
              aria-label="文档标题"
              onChange={event => persist({ ...selected, title: event.target.value })}
            />
            <button className="primary compact" onClick={exportPdf}><Download size={18} /> 导出 PDF</button>
          </section>

          <section className="workspace">
            <div className="canvas-wrap">
              <div className="page-counter">{pageIndex + 1} / {selected.pages.length}</div>
              {page && <img className="scan-page" src={page.dataUrl} alt={`第 ${pageIndex + 1} 页`} />}
              {selected.pages.length > 1 && (
                <>
                  <button className="page-nav left" disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}><ChevronLeft /></button>
                  <button className="page-nav right" disabled={pageIndex === selected.pages.length - 1} onClick={() => setPageIndex(pageIndex + 1)}><ChevronRight /></button>
                </>
              )}
            </div>

            <aside className="tool-panel">
              <div className="tool-heading"><Sparkles size={18} /> 页面增强</div>
              <div className="filter-grid">
                {([['color', '原色'], ['gray', '灰度'], ['bw', '黑白']] as [ScanFilter, string][]).map(([value, label]) => (
                  <button key={value} className={page?.filter === value ? 'filter active' : 'filter'} onClick={() => updatePage(item => applyFilter(item, value))}>
                    <span className={`filter-preview ${value}`} />{label}{page?.filter === value && <Check size={14} />}
                  </button>
                ))}
              </div>
              <div className="tool-actions">
                <button onClick={() => updatePage(rotatePage)}><RotateCw />旋转</button>
                <button onClick={runOcr}><Type />识别文字</button>
                <button onClick={() => libraryInput.current?.click()}><ImagePlus />添加页面</button>
                <button onClick={runAllOcr}><Sparkles />全文 OCR</button>
                <button onClick={exportWord}><FileType2 />导出 Word</button>
                <button className="danger" onClick={removePage}><Trash2 />删除本页</button>
              </div>
              <div className="local-note"><b>隐私说明</b><br />图片处理与 PDF 生成均在本机完成。首次 OCR 需要下载中英文识别模型。</div>
            </aside>
          </section>

          <section className="filmstrip" aria-label="页面缩略图">
            {selected.pages.map((item, index) => (
              <button key={item.id} className={index === pageIndex ? 'thumb active' : 'thumb'} onClick={() => setPageIndex(index)}>
                <img src={item.dataUrl} alt="" /><span>{index + 1}</span>
              </button>
            ))}
            <button className="add-thumb" onClick={() => cameraInput.current?.click()}><Plus /><span>扫描</span></button>
          </section>
        </main>
      ) : (
        <main className="library">
          <section className="library-head">
            <div><p className="eyebrow">DOCUMENT STUDIO</p><h1>把纸张，变成清晰的文档。</h1><p>扫描、增强、识别与导出，都在你的设备上完成。</p></div>
            <div className="new-actions">
              <button className="primary" onClick={() => cameraInput.current?.click()}><Camera /> 拍照扫描</button>
              <button className="secondary" onClick={() => libraryInput.current?.click()}><ImagePlus /> 导入图片</button>
            </div>
          </section>

          <section className="documents-section">
            <div className="section-line">
              <h2>我的文档 <span>{documents.length}</span></h2>
              <label className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题或识别文字" /></label>
            </div>
            {filtered.length ? (
              <div className="document-grid">
                {filtered.map(document => (
                  <article className="document-card" key={document.id} onClick={() => { setSelectedId(document.id); setPageIndex(0) }}>
                    <div className="document-cover">
                      <img src={document.pages[0]?.dataUrl} alt="" />
                      <span>{document.pages.length} 页</span>
                    </div>
                    <div className="document-meta"><div><h3>{document.title}</h3><p>{new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(document.updatedAt)}</p></div><MoreHorizontal /></div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span><FileText size={38} /></span><h3>{search ? '没有找到匹配文档' : '第一份扫描，从这里开始'}</h3><p>{search ? '试试其他关键词。' : '对准纸张拍照，文镜会自动寻找边缘并增强清晰度。'}</p>
                {!search && <button className="primary" onClick={() => cameraInput.current?.click()}><Camera /> 开始扫描</button>}
              </div>
            )}
          </section>
        </main>
      )}

      {busy && <div className="busy-overlay"><div><LoaderCircle className="spin" /><b>{busy}</b></div></div>}
      {ocrProgress !== null && <div className="busy-overlay"><div className="ocr-card"><LoaderCircle className="spin" /><b>正在识别文字</b><progress max="1" value={ocrProgress} /><small>{Math.round(ocrProgress * 100)}%</small></div></div>}
      {textOpen && page && (
        <div className="modal-backdrop" onClick={() => setTextOpen(false)}>
          <section className="text-modal" onClick={event => event.stopPropagation()}>
            <header><div><p className="eyebrow">OCR RESULT</p><h2>识别文字</h2></div><button className="icon-button" onClick={() => setTextOpen(false)}><X /></button></header>
            <textarea value={page.ocrText} onChange={event => {
              if (!selected) return
              const pages = selected.pages.map((item, index) => index === pageIndex ? { ...item, ocrText: event.target.value } : item)
              persist({ ...selected, pages })
            }} placeholder="未识别到文字" />
            <footer><button className="secondary" onClick={() => navigator.clipboard.writeText(page.ocrText)}>复制文字</button><button className="primary" onClick={() => setTextOpen(false)}>完成</button></footer>
          </section>
        </div>
      )}
      {installOpen && (
        <div className="modal-backdrop" onClick={() => setInstallOpen(false)}>
          <section className="install-modal" onClick={event => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">INSTALL ON APPLE</p><h2>把文镜安装到苹果设备</h2></div>
              <button className="icon-button" onClick={() => setInstallOpen(false)}><X /></button>
            </header>
            <div className="install-options">
              <article><span><Smartphone /></span><div><h3>iPhone / iPad</h3><p>使用 Safari 打开文镜，点底部的 <b><Share size={14} /> 分享</b>，然后选择“添加到主屏幕”。</p></div></article>
              <article><span><Laptop /></span><div><h3>Mac</h3><p>使用 Safari 打开文镜，在菜单栏选择“文件 → 添加到程序坞”；Chrome 也可以点击地址栏右侧的安装图标。</p></div></article>
            </div>
            <div className="sync-warning"><b>关于跨设备数据</b><br />当前版本在每台设备上独立保存文档，不会上传或自动同步。使用相同网址不等于共享文档库。</div>
            <footer><button className="primary" onClick={() => setInstallOpen(false)}>知道了</button></footer>
          </section>
        </div>
      )}
      {toolsOpen && (
        <div className="modal-backdrop" onClick={() => setToolsOpen(false)}>
          <section className="tools-modal" onClick={event => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">LOCAL DOCUMENT TOOLS</p><h2>文档工具箱</h2><p>文件只在当前设备内处理，不会上传。</p></div>
              <button className="icon-button" onClick={() => setToolsOpen(false)}><X /></button>
            </header>
            <div className="toolkit-grid">
              <button onClick={() => chooseTool('merge-pdf', '.pdf,application/pdf', true)}><span><Combine /></span><b>合并 PDF</b><small>按选择顺序合成一份文档</small></button>
              <button onClick={() => chooseTool('split-pdf')}><span><Scissors /></span><b>拆分 PDF</b><small>每页生成一个 PDF 压缩包</small></button>
              <button onClick={() => chooseTool('pdf-images')}><span><Images /></span><b>PDF 转图片</b><small>高清 JPG 页面压缩包</small></button>
              <button onClick={() => chooseTool('pdf-word')}><span><FileType2 /></span><b>PDF 转 Word</b><small>提取可编辑文字与分页</small></button>
              <button onClick={() => chooseTool('pdf-excel')}><span><FileSpreadsheet /></span><b>PDF 转 Excel</b><small>按页面和视觉间距识别行列</small></button>
              <button onClick={() => chooseTool('ppt-word', '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation')}><span><Presentation /></span><b>PPT 转 Word</b><small>提取每张幻灯片的文字</small></button>
            </div>
            <div className="quality-note"><b>转换说明</b><br />电子版 PDF 可直接提取文字和表格；纯扫描 PDF 没有文字层，建议先转为图片并使用文镜 OCR。受密码保护的文件需要先解锁。PPT 暂支持 `.pptx`。</div>
          </section>
        </div>
      )}
    </div>
  )
}
