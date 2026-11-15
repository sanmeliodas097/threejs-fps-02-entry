// EMBERLINE — navigation: breadth-first search over the world's waypoint
// graph. The graph is small (27 nodes), so BFS per bot per repath is cheap.
export function findPath(adj, from, to) {
  if (from === to) return [to];
  const prev = new Int16Array(adj.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let head = 0; head < queue.length; head += 1) {
    const n = queue[head];
    for (const m of adj[n]) {
      if (prev[m] === -1) {
        prev[m] = n;
        if (m === to) {
          const path = [to];
          let cur = to;
          while (cur !== from) { cur = prev[cur]; path.push(cur); }
          path.reverse();
          return path;
        }
        queue.push(m);
      }
    }
  }
  return [to];
}

export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i][0] - x;
    const dz = nodes[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
