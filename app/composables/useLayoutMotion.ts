// Animate the existing elements after a responsive layout switch using FLIP translation.
// No scale: text, the caret and icons keep their natural size.
export function useLayoutMotion(root: Ref<HTMLElement | undefined>, trigger: Ref<boolean>, selectors: string[]) {
  const animations = new Set<Animation>()
  let observer: ResizeObserver | undefined, frame = 0
  let previous: Array<{ node: HTMLElement; rect: DOMRect }> = []
  function capture() {
    const host = root.value
    return host ? selectors.flatMap(selector => {
      const node = host.querySelector<HTMLElement>(selector)
      return node ? [{ node, rect: node.getBoundingClientRect() }] : []
    }) : []
  }
  onMounted(() => {
    previous = capture()
    observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { previous = capture() })
    })
    if (root.value) observer.observe(root.value)
  })
  watch(trigger, async () => {
    const host = root.value
    if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const animation of animations) animation.cancel()
    animations.clear()
    const positions = previous.length ? previous : capture()
    await nextTick()
    const style = getComputedStyle(host)
    previous = capture()
    for (const { node, rect } of positions) {
      const end = node.getBoundingClientRect()
      if (!end.width || !end.height) continue
      const x = rect.left - end.left, y = rect.top - end.top
      if (Math.abs(x) + Math.abs(y) < 1) continue
      const animation = node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
        duration: parseFloat(style.getPropertyValue('--motion-default-spatial-duration')),
        easing: style.getPropertyValue('--motion-default-spatial-easing').trim(),
      })
      animations.add(animation)
      animation.finished.then(() => animations.delete(animation), () => animations.delete(animation))
    }
  }, { flush: 'pre' })
  function stop() { for (const animation of animations) animation.cancel(); animations.clear() }
  onDeactivated(stop)
  onActivated(() => { previous = capture() })
  onBeforeUnmount(() => { stop(); observer?.disconnect(); cancelAnimationFrame(frame) })
}
