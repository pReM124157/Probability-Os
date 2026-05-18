function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function matchesWhere(row, where) {
  return where.every((w) => {
    if (w.type === "eq") return row[w.col] === w.value;
    if (w.type === "in") return w.values.includes(row[w.col]);
    if (w.type === "gte") return row[w.col] >= w.value;
    if (w.type === "lte") return row[w.col] <= w.value;
    return true;
  });
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    if (a[orderBy.col] === b[orderBy.col]) return 0;
    return (a[orderBy.col] > b[orderBy.col] ? 1 : -1) * (orderBy.asc ? 1 : -1);
  });
  return out;
}

function applyProjection(rows, projection) {
  if (!projection || projection === "*") return rows;
  const cols = projection.split(",").map((c) => c.trim()).filter(Boolean);
  return rows.map((row) => {
    const out = {};
    for (const c of cols) out[c] = row[c];
    return out;
  });
}

export function createMockSupabase(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([k, v]) => [k, clone(v)]));
  const rpcCalls = [];
  const events = [];

  function tableRows(name) {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  }

  function queryBuilder(name) {
    const state = {
      where: [],
      orderBy: null,
      limit: null,
      projection: "*",
      action: "select",
      payload: null,
      onConflict: null,
      deleteMode: false
    };

    const api = {
      select(projection = "*") {
        state.action = "select";
        state.projection = projection;
        return api;
      },
      insert(payload) {
        state.action = "insert";
        state.payload = Array.isArray(payload) ? payload : [payload];
        const insertError = executeWrite();
        const inserted = clone(state.payload);
        return {
          select() {
            return {
              maybeSingle() {
                return Promise.resolve({ data: insertError ? null : (inserted[0] || null), error: insertError });
              },
              then(resolve) {
                return Promise.resolve({ data: insertError ? null : inserted, error: insertError }).then(resolve);
              }
            };
          },
          maybeSingle() {
            return Promise.resolve({ data: insertError ? null : (inserted[0] || null), error: insertError });
          }
        };
      },
      upsert(payload, options = {}) {
        state.action = "upsert";
        state.payload = Array.isArray(payload) ? payload : [payload];
        state.onConflict = options.onConflict || null;
        executeUpsert();
        return Promise.resolve({ data: clone(state.payload), error: null });
      },
      update(payload) {
        state.action = "update";
        state.payload = payload || {};
        return api;
      },
      delete() {
        state.action = "delete";
        return api;
      },
      eq(col, value) {
        state.where.push({ type: "eq", col, value });
        return api;
      },
      in(col, values) {
        state.where.push({ type: "in", col, values });
        return api;
      },
      gte(col, value) {
        state.where.push({ type: "gte", col, value });
        return api;
      },
      lte(col, value) {
        state.where.push({ type: "lte", col, value });
        return api;
      },
      order(col, opts = {}) {
        state.orderBy = { col, asc: opts.ascending !== false };
        return api;
      },
      limit(n) {
        state.limit = n;
        return api;
      },
      maybeSingle() {
        const result = executeSelect();
        return Promise.resolve({ data: result[0] || null, error: null });
      },
      then(resolve) {
        const result = executeGeneric();
        return Promise.resolve(result).then(resolve);
      }
    };

    function executeSelect() {
      const rows = tableRows(name);
      const filtered = rows.filter((r) => matchesWhere(r, state.where));
      const sorted = sortRows(filtered, state.orderBy);
      const limited = state.limit == null ? sorted : sorted.slice(0, state.limit);
      return applyProjection(clone(limited), state.projection);
    }

    function executeWrite() {
      const rows = tableRows(name);
      for (const p of state.payload) {
        const uniqueKeys = ["event_id", "id", "recommendation_id"];
        const duplicate = uniqueKeys.some((key) => p[key] != null && rows.some((r) => r[key] === p[key]));
        if (duplicate) {
          return { code: "23505", message: "duplicate key value violates unique constraint" };
        }
        rows.push(clone(p));
      }
      tables.set(name, rows);
      return null;
    }

    function executeUpsert() {
      const rows = tableRows(name);
      for (const p of state.payload) {
        if (!state.onConflict) {
          rows.push(clone(p));
          continue;
        }
        const keys = String(state.onConflict).split(",").map((k) => k.trim());
        const idx = rows.findIndex((r) => keys.every((k) => r[k] === p[k]));
        if (idx === -1) rows.push(clone(p));
        else rows[idx] = { ...rows[idx], ...clone(p) };
      }
      tables.set(name, rows);
    }

    function executeUpdate() {
      const rows = tableRows(name);
      const updated = [];
      for (let i = 0; i < rows.length; i += 1) {
        if (matchesWhere(rows[i], state.where)) {
          rows[i] = { ...rows[i], ...clone(state.payload) };
          updated.push(clone(rows[i]));
        }
      }
      tables.set(name, rows);
      return updated;
    }

    function executeDelete() {
      const rows = tableRows(name);
      const kept = [];
      let removed = 0;
      for (const row of rows) {
        if (matchesWhere(row, state.where)) removed += 1;
        else kept.push(row);
      }
      tables.set(name, kept);
      return removed;
    }

    function executeGeneric() {
      if (state.action === "select") {
        return { data: executeSelect(), error: null };
      }
      if (state.action === "update") {
        return { data: executeUpdate(), error: null };
      }
      if (state.action === "delete") {
        executeDelete();
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }

    return api;
  }

  return {
    from(name) {
      return queryBuilder(name);
    },
    rpc(name, params = {}) {
      rpcCalls.push({ name, params: clone(params) });
      if (name === "claim_scheduler_lease") {
        const rows = tableRows("__leases__");
        const existing = rows.find((r) => r.lease_name === params.p_lease_name);
        const now = Date.now();
        if (!existing || existing.lease_until <= now || existing.owner_id === params.p_owner_id) {
          const leaseUntil = now + Number(params.p_ttl_seconds || 120) * 1000;
          if (!existing) rows.push({ lease_name: params.p_lease_name, owner_id: params.p_owner_id, lease_until: leaseUntil });
          else Object.assign(existing, { owner_id: params.p_owner_id, lease_until: leaseUntil });
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: false, error: null });
      }
      if (name === "renew_scheduler_lease") {
        const rows = tableRows("__leases__");
        const existing = rows.find((r) => r.lease_name === params.p_lease_name);
        if (!existing || existing.owner_id !== params.p_owner_id) return Promise.resolve({ data: false, error: null });
        existing.lease_until = Date.now() + Number(params.p_ttl_seconds || 120) * 1000;
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "release_scheduler_lease") {
        const rows = tableRows("__leases__");
        const idx = rows.findIndex((r) => r.lease_name === params.p_lease_name && r.owner_id === params.p_owner_id);
        if (idx === -1) return Promise.resolve({ data: false, error: null });
        rows.splice(idx, 1);
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "claim_execution_action") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
    __getTable(name) {
      return clone(tableRows(name));
    },
    __getRpcCalls() {
      return clone(rpcCalls);
    },
    __pushEvent(evt) {
      events.push(evt);
    },
    __getEvents() {
      return clone(events);
    }
  };
}
