// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

it('keeps menu anchors from taking the free space beside workspace header controls', () => {
  const host = document.createElement('style')
  host.textContent = '._root_70kcw_1{display:inline-flex;flex:0 1 auto}.workspace_root{max-height:100cqh}'
  document.head.append(host)
  const frame = document.createElement('div')
  frame.className = 'host_frame'
  // Preserve the installed host's slot wrapper and both Menu roots, including the empty picker anchor.
  frame.innerHTML = '<aside class="host_sidebarCol"><div class="host_root">'
    + '<div class="host_logoRow">品牌</div><nav class="host_panelList">插件</nav>'
    + '<div class="host_regionArea"><div data-slot="sidebar.workspaces" style="display:contents">'
    + '<div class="workspace_root"><div class="workspace_sectionHeader" data-sidebar-workspace-header>'
    + '<span class="workspace_sectionLabel">工作区</span>'
    + '<div class="workspace_searchSlot"><button aria-label="搜索会话">搜索</button></div>'
    + '<div class="workspace_headerActions"><span class="_root_70kcw_1"><button aria-label="视图选项">视图</button></span>'
    + '<button aria-label="添加工作区">添加</button></div><span class="_root_70kcw_1"></span>'
    + '<div data-slot="sidebar.workspaces.directoryFlow" style="display:contents"></div>'
    + '</div></div></div></div></div></aside>'
  document.body.append(frame)
  const dispose = applyDrawerSelection()
  const header = frame.querySelector<HTMLElement>('[data-sidebar-workspace-header]')!
  const picks: string[] = []
  for (const button of header.querySelectorAll('button')) button.onclick = () => { picks.push(button.ariaLabel!) }
  try {
    expect(getComputedStyle(frame.querySelector('.workspace_root')!).maxHeight).toBe('none')
    for (const anchor of header.querySelectorAll('._root_70kcw_1')) {
      expect(getComputedStyle(anchor).flexGrow).toBe('0')
      expect(getComputedStyle(anchor).minHeight).not.toBe('0px')
    }
    expect(getComputedStyle(header).justifyContent).toBe('flex-end')
    expect(getComputedStyle(header.querySelector('.workspace_sectionLabel')!).marginRight).toBe('auto')
    for (const button of header.querySelectorAll('button')) button.click()
    expect(picks).toEqual(['搜索会话', '视图选项', '添加工作区'])
  } finally { dispose(); frame.remove(); host.remove() }
})
