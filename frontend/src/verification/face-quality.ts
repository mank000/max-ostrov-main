export type Face = { score: number; box?: { originX: number; originY: number; width: number; height: number } }
// The detector sees the same centered portrait crop as the camera preview.
export function faceReadiness(faces: Face[], width: number, height: number) {
  if (faces.length > 1) return 'В кадре должно быть только одно лицо'
  const face = faces[0], b = face?.box
  if (!b || face.score < .8) return 'Поднесите лицо к камере'
  if (b.width / width < .24) return 'Держите лицо чуть ближе'
  if (b.width / width > .9 || b.originX < width * .01 || b.originY < height * .01 || b.originX + b.width > width * .99 || b.originY + b.height > height * .99) return 'Держите телефон чуть дальше'
  if (Math.abs((b.originX + b.width / 2) / width - .5) > .16 || Math.abs((b.originY + b.height / 2) / height - .5) > .2) return 'Поместите лицо в центр рамки'
  return ''
}
