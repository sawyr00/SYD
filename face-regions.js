// Primitive order matches Narby_Head-Web.glb, which retained the original material groups.
const expectedTriangles = [3212, 28420, 1445, 3879, 146, 617, 718];

function connectedPieces(positions, indices) {
  const count = positions.length / 3;
  const parents = Int32Array.from({ length: count }, (_, index) => index);
  function root(index) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  function join(a, b) {
    parents[root(a)] = root(b);
  }

  const coincident = new Map();
  for (let index = 0; index < count; index++) {
    const i = index * 3;
    const key = [positions[i], positions[i + 1], positions[i + 2]]
      .map(value => Math.round(value * 100000)).join(',');
    if (coincident.has(key)) join(index, coincident.get(key));
    else coincident.set(key, index);
  }
  for (let i = 0; i < indices.length; i += 3) {
    join(indices[i], indices[i + 1]);
    join(indices[i], indices[i + 2]);
  }

  const pieces = new Map();
  for (let index = 0; index < count; index++) {
    const id = root(index);
    let piece = pieces.get(id);
    if (!piece) {
      piece = { vertices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      pieces.set(id, piece);
    }
    piece.vertices.push(index);
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[index * 3 + axis];
      piece.min[axis] = Math.min(piece.min[axis], value);
      piece.max[axis] = Math.max(piece.max[axis], value);
    }
  }
  return pieces.values();
}

export function identifyNarbyRegions(positions, indices) {
  const primitive = expectedTriangles.indexOf(indices.length / 3);
  if (primitive < 0) throw new Error('Unexpected geometry in the Narby web model');
  return Array.from(connectedPieces(positions, indices)).flatMap(({ vertices, min, max }, index) => {
    const center = min.map((value, axis) => (value + max[axis]) / 2);
    let name;
    let axis;
    let reverse = false;
    let follower = false;
    switch (primitive) {
      case 0:
        if (min[1] < 0) {
          name = 'skin';
        } else {
          name = center[0] < 0 ? 'left-ear' : 'right-ear';
          axis = 0;
          reverse = center[0] < 0;
        }
        break;
      case 1:
        name = min[2] > 1.3 && max[1] < 0.4
          ? (center[0] < 0 ? 'left-pupil' : 'right-pupil')
          : 'hat';
        if (name.endsWith('-pupil')) axis = 2;
        break;
      case 2:
        name = min[1] > 1 ? 'hat' : 'sunglasses';
        break;
      case 3:
        if (max[1] >= -0.2) return splitAtMidline(positions, vertices, 'eye-white', 2);
        if (min[0] < -0.2 && max[0] > 0.2) return splitAtMidline(positions, vertices, 'center-tooth');
        name = `tooth-${index}`;
        ({ axis, reverse } = toothRoot(positions, vertices, min, max));
        break;
      case 4:
        name = 'nose';
        axis = 2;
        break;
      case 5:
        name = `hair-${index}`;
        axis = 1;
        break;
      case 6:
        name = center[0] < 0 ? 'left-ear' : 'right-ear';
        follower = true;
        break;
    }
    return { name, axis, reverse, follower, vertices, center, min, max };
  });
}

function splitAtMidline(positions, vertices, name, axis) {
  const midline = -0.015;
  return [-1, 1].map(side => {
    const half = vertices.filter(index => (positions[index * 3] < midline ? -1 : 1) === side);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const index of half) {
      for (let a = 0; a < 3; a++) {
        const value = positions[index * 3 + a];
        min[a] = Math.min(min[a], value);
        max[a] = Math.max(max[a], value);
      }
    }
    const root = axis === undefined ? toothRoot(positions, half, min, max) : { axis, reverse: false };
    return {
      ...root, min, max, vertices: half, midline,
      name: `${side < 0 ? 'left' : 'right'}-${name}`,
      center: min.map((value, a) => (value + max[a]) / 2)
    };
  });
}

function toothRoot(positions, vertices, min, max) {
  const size = min.map((value, axis) => max[axis] - value);
  const axis = size.indexOf(Math.max(...size));
  const other = [0, 1, 2].filter(a => a !== axis);
  function endWidth(high) {
    const lo = [Infinity, Infinity];
    const hi = [-Infinity, -Infinity];
    for (const index of vertices) {
      const i = index * 3;
      const t = (positions[i + axis] - min[axis]) / size[axis];
      if (high ? t < 0.65 : t > 0.35) continue;
      for (const [dimension, a] of other.entries()) {
        lo[dimension] = Math.min(lo[dimension], positions[i + a]);
        hi[dimension] = Math.max(hi[dimension], positions[i + a]);
      }
    }
    return Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
  }
  return { axis, reverse: endWidth(true) > endWidth(false) };
}
