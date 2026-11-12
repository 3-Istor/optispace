// Sparks on a primary action, after the Click Spark effect of React Bits. DOM nodes instead of its canvas:
// most primary buttons sit in a native <dialog>, whose top layer a page canvas cannot draw over.
const COUNT = 8
const LIFE_MS = 480 // --t3

document.addEventListener('click', (e) => {
  const button = e.target.closest?.('.btn-p')
  if (!button || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const box = button.getBoundingClientRect()
  // detail 0: keyboard activation, which has no pointer position.
  const x = e.detail ? e.clientX : box.left + box.width / 2
  const y = e.detail ? e.clientY : box.top + box.height / 2
  const host = button.closest('dialog') ?? document.body
  for (let i = 0; i < COUNT; i++) {
    const spark = document.createElement('i')
    spark.className = 'spark'
    spark.style.cssText = `left:${x}px;top:${y}px;--a:${i * (360 / COUNT) + 12}deg`
    setTimeout(() => spark.remove(), LIFE_MS) // not animationend: it never fires once the dialog has closed
    host.append(spark)
  }
})
