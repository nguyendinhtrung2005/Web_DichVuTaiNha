import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { demoAccounts, initialOrders } from "../data/demoOrders";
import { products as initialProducts } from "../data/products";

const STORAGE_KEY = "cleanhome-demo-session";
const ORDERS_KEY = "cleanhome-demo-orders";
const PRODUCTS_KEY = "cleanhome-demo-products";
const PRODUCT_ORDERS_KEY = "cleanhome-demo-product-orders";
const AuthContext = createContext(null);

function readStoredValue(key, fallback) {
  const value = window.localStorage.getItem(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(`Không thể đọc dữ liệu demo "${key}".`, error);
    window.localStorage.removeItem(key);
    return fallback;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredValue(STORAGE_KEY, null));
  const [orders, setOrders] = useState(() => readStoredValue(ORDERS_KEY, initialOrders));
  const [products, setProducts] = useState(() => readStoredValue(PRODUCTS_KEY, initialProducts));
  const [productOrders, setProductOrders] = useState(() => readStoredValue(PRODUCT_ORDERS_KEY, []));

  useEffect(() => {
    if (user) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(STORAGE_KEY);
  }, [user]);

  useEffect(() => {
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    window.localStorage.setItem(PRODUCT_ORDERS_KEY, JSON.stringify(productOrders));
  }, [productOrders]);

  const value = useMemo(
    () => ({
      user,
      orders,
      products,
      productOrders,
      login(email, password) {
        const account = demoAccounts.find(
          (item) => item.email.toLowerCase() === email.trim().toLowerCase() && item.password === password,
        );
        if (!account) {
          return { ok: false, error: "Email hoặc mật khẩu chưa đúng. Hãy dùng một tài khoản demo bên dưới." };
        }
        const { password: _password, ...safeUser } = account;
        setUser(safeUser);
        return { ok: true, user: safeUser };
      },
      register({ name, email, phone }) {
        const safeUser = {
          id: `guest-${Date.now()}`,
          role: "user",
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: "",
        };
        setUser(safeUser);
        return { ok: true, user: safeUser };
      },
      logout() {
        setUser(null);
      },
      updateProfile(updates) {
        setUser((current) => ({ ...current, ...updates }));
      },
      createOrder(order) {
        const created = {
          ...order,
          id: `NT-${String(Date.now()).slice(-6)}`,
          customerId: user?.id ?? "guest",
          customer: user?.name ?? "Khách hàng",
          status: "pending",
          staffId: null,
          staff: "Chưa phân công",
          createdAt: new Date().toISOString(),
        };
        setOrders((current) => [created, ...current]);
        return created;
      },
      updateOrder(id, updates) {
        setOrders((current) => current.map((order) => (order.id === id ? { ...order, ...updates } : order)));
      },
      saveProduct(product) {
        const saved = {
          ...product,
          id: product.id || `prd-${Date.now()}`,
          price: Number(product.price),
          stock: Number(product.stock),
        };
        setProducts((current) => product.id
          ? current.map((item) => item.id === product.id ? saved : item)
          : [saved, ...current]);
        return saved;
      },
      deleteProduct(id) {
        if (productOrders.some((order) => order.items.some((item) => item.productId === id))) {
          return { ok: false, error: "Không thể xóa sản phẩm đã có trong đơn mua." };
        }
        setProducts((current) => current.filter((product) => product.id !== id));
        return { ok: true };
      },
      createProductOrder({ items, address, phone }) {
        const productById = new Map(products.map((product) => [product.id, product]));
        for (const item of items) {
          const product = productById.get(item.productId);
          if (!product || product.stock < item.quantity) {
            return { ok: false, error: `Sản phẩm "${product?.name || "đã chọn"}" không đủ tồn kho.` };
          }
        }
        const created = {
          id: `SP-${String(Date.now()).slice(-6)}`,
          customerId: user?.id || "guest",
          customer: user?.name || "Khách hàng",
          address: address.trim(),
          phone: phone.trim(),
          items: items.map((item) => {
            const product = productById.get(item.productId);
            return {
              productId: product.id,
              name: product.name,
              quantity: item.quantity,
              price: product.price,
            };
          }),
          total: items.reduce((sum, item) => sum + productById.get(item.productId).price * item.quantity, 0),
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        setProducts((current) => current.map((product) => {
          const purchased = items.find((item) => item.productId === product.id);
          return purchased ? { ...product, stock: product.stock - purchased.quantity } : product;
        }));
        setProductOrders((current) => [created, ...current]);
        return { ok: true, order: created };
      },
      updateProductOrder(id, status) {
        const target = productOrders.find((order) => order.id === id);
        if (status === "cancelled" && target?.status === "pending") {
          setProducts((current) => current.map((product) => {
            const returnedQuantity = target.items
              .filter((item) => item.productId === product.id)
              .reduce((sum, item) => sum + item.quantity, 0);
            return returnedQuantity ? { ...product, stock: product.stock + returnedQuantity } : product;
          }));
        }
        setProductOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order));
      },
    }),
    [user, orders, products, productOrders],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth phải được dùng bên trong AuthProvider.");
  return context;
}
