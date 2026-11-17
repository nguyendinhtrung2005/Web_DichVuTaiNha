/** Defer a compatibility singleton until a consumer invokes its pool interface. */
export function createLazyPool(factory) {
  if (typeof factory !== 'function') throw new TypeError('Pool factory required');
  let instance, closed = false;
  const getPool = () => {
    if (closed) throw new Error('POOL_CLOSED');
    if (!instance) instance = factory();
    return instance;
  };
  const end = async () => {
    if (closed) return;
    closed = true;
    if (instance) await instance.end();
  };
  return new Proxy({}, {
    get(_target, key) {
      if (key === 'then') return undefined;
      if (key === Symbol.toStringTag) return 'CleanHomeLazyPool';
      if (key === 'end') return end;
      const current = getPool(), value = Reflect.get(current, key, current);
      return typeof value === 'function' ? value.bind(current) : value;
    },
    has(_target, key) { return key === 'end' || key in getPool(); },
  });
}
