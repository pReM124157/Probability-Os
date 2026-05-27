function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyWhere(rows, where) {
  return rows.filter((row) => {
    return where.every((w) => {
      if (w.type === "eq") return row[w.col || w.column] === w.value;
      if (w.type === "in") return w.values.includes(row[w.col || w.column]);
      if (w.type === "gte") return row[w.col || w.column] >= w.value;
      if (w.type === "lte") return row[w.col || w.column] <= w.value;
      return true;
    });
  });
}

function createState() {
  return {
    where: [],
    payload: null,
    limitValue: null,
    orderBy: null,
  };
}

export function createMockSupabase(seed = {}) {
  const tables = clone(seed);

  return {
    __getTable(name) {
      return tables[name] || [];
    },

    rpc(name, params = {}) {
      return Promise.resolve({ data: null, error: null });
    },

    from(tableName) {
      if (!tables[tableName]) {
        tables[tableName] = [];
      }

      const table = tables[tableName];

      // ✅ FIXED: fresh state on every from() call
      let state = createState();

      function executeSelect() {
        let rows = applyWhere(table, state.where);

        if (state.orderBy) {
          rows = rows.sort((a, b) => {
            const av = a[state.orderBy.col];
            const bv = b[state.orderBy.col];
            if (av === bv) return 0;
            return state.orderBy.asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
          });
        }

        if (state.limitValue != null) {
          rows = rows.slice(0, state.limitValue);
        }

        return Promise.resolve({ data: clone(rows), error: null });
      }

      function executeUpdate() {
        const rows = applyWhere(table, state.where);
        rows.forEach((row) => Object.assign(row, state.payload));
        return Promise.resolve({ data: clone(rows), error: null });
      }

      function executeUpsert() {
        for (const payloadRow of state.payload) {
          const existingIndex = table.findIndex((row) => {
            if (payloadRow.recommendation_id !== undefined) return row.recommendation_id === payloadRow.recommendation_id;
            if (payloadRow.event_id !== undefined) return row.event_id === payloadRow.event_id;
            if (payloadRow.telegram_chat_id !== undefined) return row.telegram_chat_id === payloadRow.telegram_chat_id;
            if (payloadRow.id !== undefined) return row.id === payloadRow.id;
            return false;
          });
          if (existingIndex >= 0) {
            table[existingIndex] = { ...table[existingIndex], ...payloadRow };
          } else {
            table.push(clone(payloadRow));
          }
        }
      }

      const api = {
        select() {
          api.then = (resolve, reject) => executeSelect().then(resolve, reject);
          return api;
        },

        update(payload) {
          state.payload = payload || {};

          const updateChain = {
            _promise: null,
            eq(col, value) {
              state.where.push({ type: "eq", col, value });
              return updateChain;
            },
            in(col, values) {
              state.where.push({ type: "in", col, values });
              return updateChain;
            },
            select() {
              updateChain._promise = updateChain._promise || executeUpdate();
              return updateChain._promise;
            },
            then(resolve, reject) {
              updateChain._promise = updateChain._promise || executeUpdate();
              return updateChain._promise.then(resolve, reject);
            }
          };

          return updateChain;
        },

        upsert(payload) {
          state.payload = Array.isArray(payload) ? payload : [payload];
          executeUpsert();
          return Promise.resolve({ data: clone(state.payload), error: null });
        },

        insert(payload) {
          const rows = Array.isArray(payload) ? payload : [payload];
          for (const row of rows) {
            // Check for unique violation on event_id
            if (row.event_id !== undefined) {
              const exists = table.some(r => r.event_id === row.event_id);
              if (exists) {
                // Simulate Postgres unique violation
                Object.assign(api, {
                  _insertError: { code: '23505', message: 'duplicate key value violates unique constraint' }
                });
                return api;
              }
            }
            table.push(JSON.parse(JSON.stringify(row)));
          }
          Object.assign(api, { _insertError: null });
          return api;
        },

        delete() {
          return Promise.resolve({ data: [], error: null });
        },

        eq(col, value) {
          state.where.push({ type: "eq", column: col, value });
          return api;
        },

        in(col, values) {
          state.where.push({ type: "in", column: col, values });
          return api;
        },

        gte(col, value) {
          state.where.push({ type: "gte", column: col, value });
          return api;
        },

        lte(col, value) {
          state.where.push({ type: "lte", column: col, value });
          return api;
        },

        order(col, opts = {}) {
          state.orderBy = { col, asc: opts.ascending !== false };
          return api;
        },

        limit(value) {
          state.limitValue = value;
          return api;
        },

        maybeSingle() {
          if (api._insertError) {
            const err = api._insertError;
            api._insertError = null;
            return Promise.resolve({ data: null, error: err });
          }
          return executeSelect().then(({ data, error }) => ({
            data: data && data.length > 0 ? data[0] : null,
            error
          }));
        },

        single() {
          return executeSelect().then(({ data, error }) => ({
            data: data && data.length > 0 ? data[0] : null,
            error
          }));
        },

        then(resolve, reject) {
          return executeSelect().then(resolve, reject);
        }
      };

      return api;
    }
  };
}

export default createMockSupabase;

