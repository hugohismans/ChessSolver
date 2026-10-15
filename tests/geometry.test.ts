import { describe, expect, it } from 'vitest'
import { applyH, homography, homographyLSQ, invert3, isConvex, orderCorners, rotateQuad, type Pt } from '../src/lib/vision/geometry'

const close = (a: Pt, b: Pt) => {
  expect(a.x).toBeCloseTo(b.x, 6)
  expect(a.y).toBeCloseTo(b.y, 6)
}

describe('géométrie', () => {
  const src = [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 8 },
    { x: 0, y: 8 },
  ]
  const dst = [
    { x: 120, y: 80 },
    { x: 510, y: 95 },
    { x: 600, y: 430 },
    { x: 60, y: 400 },
  ]

  it('homographie exacte sur 4 points et inverse', () => {
    const H = homography(src, dst)
    src.forEach((p, i) => close(applyH(H, p), dst[i]))
    const Hi = invert3(H)
    dst.forEach((p, i) => close(applyH(Hi, p), src[i]))
  })

  it('homographie aux moindres carrés sur les 49 coins', () => {
    const H = homography(src, dst)
    const from: Pt[] = []
    const to: Pt[] = []
    for (let j = 1; j <= 7; j++)
      for (let i = 1; i <= 7; i++) {
        from.push({ x: i, y: j })
        to.push(applyH(H, { x: i, y: j }))
      }
    const H2 = homographyLSQ(from, to)
    src.forEach((p, i) => {
      const q = applyH(H2, p)
      expect(Math.hypot(q.x - dst[i].x, q.y - dst[i].y)).toBeLessThan(1e-6)
    })
  })

  it('remet les coins dans l’ordre et teste la convexité', () => {
    const shuffled = [dst[2], dst[0], dst[3], dst[1]]
    expect(orderCorners(shuffled)).toEqual(dst)
    expect(isConvex(dst)).toBe(true)
    expect(isConvex([dst[0], dst[2], dst[1], dst[3]])).toBe(false)
    expect(rotateQuad(orderCorners(dst), 1)[0]).toEqual(dst[1])
  })
})
