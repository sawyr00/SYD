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
  return Array.from(connectedPieces(positions, indices), ({ vertices, min, max }, index) => {
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
        break;
      case 2:
        name = min[1] > 1 ? 'hat' : 'sunglasses';
        break;
      case 3:
        name = max[1] < -0.2 ? `tooth-${index}` : 'eye-whites';
        if (name.startsWith('tooth-')) axis = 2;
        break;
      case 4:
        name = 'nose';
        axis = 2;
        break;
      case 5:
        name = `hair-${index}`;
        axis = 1;
        reverse = true;
        break;
      case 6:
        name = center[0] < 0 ? 'left-ear' : 'right-ear';
        follower = true;
        break;
    }
    return { name, axis, reverse, follower, vertices, center, min, max };
  });
}
