import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const SHOP = process.env.SHOPIFY_SHOP; // sofia-sarkany.myshopify.com
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN; // shpat_...
const API_VERSION = '2024-01';
const BASE = `https://${SHOP}/admin/api/${API_VERSION}`;

const headers = {
  'X-Shopify-Access-Token': TOKEN,
  'Content-Type': 'application/json',
};

async function shopifyGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Tool definitions ────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_orders',
    description: 'Obtiene órdenes de Shopify. Filtrá por estado, fecha y cantidad.',
    inputSchema: {
      type: 'object',
      properties: {
        status:         { type: 'string', description: 'any | open | closed | cancelled (default: any)' },
        limit:          { type: 'number', description: 'Cantidad de órdenes (max 250, default 50)' },
        created_at_min: { type: 'string', description: 'Fecha inicio ISO 8601 ej: 2024-01-01' },
        created_at_max: { type: 'string', description: 'Fecha fin ISO 8601 ej: 2024-12-31' },
      }
    }
  },
  {
    name: 'get_order_detail',
    description: 'Detalle completo de una orden por ID',
    inputSchema: {
      type: 'object',
      required: ['order_id'],
      properties: {
        order_id: { type: 'string', description: 'ID numérico de la orden Shopify' }
      }
    }
  },
  {
    name: 'get_products',
    description: 'Lista productos del catálogo Shopify con precios y stock',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number', description: 'Cantidad (max 250, default 50)' },
        status: { type: 'string', description: 'active | archived | draft (default: active)' },
        vendor: { type: 'string', description: 'Filtrar por proveedor/marca' },
      }
    }
  },
  {
    name: 'get_inventory',
    description: 'Stock disponible de un producto o variante específica',
    inputSchema: {
      type: 'object',
      required: ['inventory_item_id'],
      properties: {
        inventory_item_id: { type: 'string', description: 'ID del inventory item de Shopify' }
      }
    }
  },
  {
    name: 'get_customers',
    description: 'Lista clientes con su historial de compras y datos de contacto',
    inputSchema: {
      type: 'object',
      properties: {
        limit:          { type: 'number', description: 'Cantidad (max 250, default 50)' },
        created_at_min: { type: 'string', description: 'Clientes creados desde esta fecha' },
      }
    }
  },
  {
    name: 'get_sales_summary',
    description: 'Resumen de ventas: total facturado, ticket promedio, órdenes por estado en un período',
    inputSchema: {
      type: 'object',
      properties: {
        created_at_min: { type: 'string', description: 'Fecha inicio ej: 2024-01-01' },
        created_at_max: { type: 'string', description: 'Fecha fin ej: 2024-12-31' },
      }
    }
  },
  {
    name: 'get_top_products',
    description: 'Productos más vendidos en un período, ordenados por cantidad vendida',
    inputSchema: {
      type: 'object',
      properties: {
        created_at_min: { type: 'string', description: 'Fecha inicio' },
        created_at_max: { type: 'string', description: 'Fecha fin' },
        limit:          { type: 'number', description: 'Cantidad de órdenes a analizar (default 250)' },
      }
    }
  },
];

// ── Tool logic ───────────────────────────────────────────────

async function callTool(name, input = {}) {

  if (name === 'get_orders') {
    const params = new URLSearchParams({
      status: input.status || 'any',
      limit:  Math.min(input.limit || 50, 250),
    });
    if (input.created_at_min) params.set('created_at_min', input.created_at_min);
    if (input.created_at_max) params.set('created_at_max', input.created_at_max);

    const data = await shopifyGet(`/orders.json?${params}`);
    return {
      count: data.orders.length,
      orders: data.orders.map(o => ({
        id:          o.id,
        name:        o.name,
        status:      o.financial_status,
        fulfillment: o.fulfillment_status,
        total:       parseFloat(o.total_price),
        currency:    o.currency,
        customer:    o.customer ? `${o.customer.first_name} ${o.customer.last_name}`.trim() : 'Guest',
        email:       o.email,
        items:       o.line_items?.length,
        created_at:  o.created_at,
      }))
    };
  }

  if (name === 'get_order_detail') {
    const data = await shopifyGet(`/orders/${input.order_id}.json`);
    const o = data.order;
    return {
      id:          o.id,
      name:        o.name,
      status:      o.financial_status,
      fulfillment: o.fulfillment_status,
      total:       parseFloat(o.total_price),
      currency:    o.currency,
      customer:    o.customer,
      items:       o.line_items?.map(i => ({
        title:    i.title,
        variant:  i.variant_title,
        quantity: i.quantity,
        price:    parseFloat(i.price),
        sku:      i.sku,
      })),
      shipping:   o.shipping_address,
      note:       o.note,
      tags:       o.tags,
      created_at: o.created_at,
    };
  }

  if (name === 'get_products') {
    const params = new URLSearchParams({
      limit:  Math.min(input.limit || 50, 250),
      status: input.status || 'active',
    });
    if (input.vendor) params.set('vendor', input.vendor);

    const data = await shopifyGet(`/products.json?${params}`);
    return {
      count: data.products.length,
      products: data.products.map(p => ({
        id:       p.id,
        title:    p.title,
        vendor:   p.vendor,
        type:     p.product_type,
        status:   p.status,
        tags:     p.tags,
        variants: p.variants?.map(v => ({
          id:                v.id,
          title:             v.title,
          price:             parseFloat(v.price),
          sku:               v.sku,
          inventory_qty:     v.inventory_quantity,
          inventory_item_id: v.inventory_item_id,
        })),
        created_at: p.created_at,
      }))
    };
  }

  if (name === 'get_inventory') {
    const data = await shopifyGet(`/inventory_levels.json?inventory_item_ids=${input.inventory_item_id}`);
    return data.inventory_levels;
  }

  if (name === 'get_customers') {
    const params = new URLSearchParams({ limit: Math.min(input.limit || 50, 250) });
    if (input.created_at_min) params.set('created_at_min', input.created_at_min);

    const data = await shopifyGet(`/customers.json?${params}`);
    return {
      count: data.customers.length,
      customers: data.customers.map(c => ({
        id:           c.id,
        name:         `${c.first_name} ${c.last_name}`.trim(),
        email:        c.email,
        orders_count: c.orders_count,
        total_spent:  parseFloat(c.total_spent),
        currency:     c.currency,
        created_at:   c.created_at,
        tags:         c.tags,
      }))
    };
  }

  if (name === 'get_sales_summary') {
    const params = new URLSearchParams({ limit: 250, status: 'any' });
    if (input.created_at_min) params.set('created_at_min', input.created_at_min);
    if (input.created_at_max) params.set('created_at_max', input.created_at_max);

    const data = await shopifyGet(`/orders.json?${params}`);
    const orders = data.orders;
    const total = orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
    const byStatus = {};
    const byFulfillment = {};
    orders.forEach(o => {
      byStatus[o.financial_status] = (byStatus[o.financial_status] || 0) + 1;
      byFulfillment[o.fulfillment_status || 'unfulfilled'] = (byFulfillment[o.fulfillment_status || 'unfulfilled'] || 0) + 1;
    });

    return {
      period:              { from: input.created_at_min, to: input.created_at_max },
      totalOrders:         orders.length,
      totalRevenue:        Math.round(total * 100) / 100,
      avgTicket:           orders.length ? Math.round(total / orders.length * 100) / 100 : 0,
      currency:            orders[0]?.currency,
      byFinancialStatus:   byStatus,
      byFulfillmentStatus: byFulfillment,
    };
  }

  if (name === 'get_top_products') {
    const params = new URLSearchParams({ limit: Math.min(input.limit || 250, 250), status: 'any' });
    if (input.created_at_min) params.set('created_at_min', input.created_at_min);
    if (input.created_at_max) params.set('created_at_max', input.created_at_max);

    const data = await shopifyGet(`/orders.json?${params}`);
    const productMap = {};
    data.orders.forEach(o => {
      o.line_items?.forEach(item => {
        const key = item.product_id;
        if (!productMap[key]) {
          productMap[key] = { id: key, title: item.title, quantity: 0, revenue: 0 };
        }
        productMap[key].quantity += item.quantity;
        productMap[key].revenue += parseFloat(item.price) * item.quantity;
      });
    });

    return Object.values(productMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 20)
      .map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));
  }

  throw new Error(`Tool desconocida: ${name}`);
}

// ── MCP SSE endpoint (GET /mcp) ────────────────────────────────
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.write(`event: endpoint\ndata: /mcp\n\n`);

  req.on('close', () => res.end());
});

// ── MCP JSON-RPC endpoint (POST /mcp) ─────────────────────────
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  try {
    let result;

    if (method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'shopify-mcp', version: '1.0.0' },
      };
    }

    else if (method === 'notifications/initialized') {
      return res.status(204).end();
    }

    else if (method === 'tools/list') {
      result = { tools: TOOLS };
    }

    else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const toolResult = await callTool(name, args || {});
      result = {
        content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
      };
    }

    else {
      return res.json({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    }

    return res.json({ jsonrpc: '2.0', id, result });

  } catch (err) {
    return res.json({
      jsonrpc: '2.0', id,
      error: { code: -32603, message: err.message }
    });
  }
});

// ── Health check ───────────────────────────────────────────────
app.get('/api/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ status: 'ok', server: 'shopify-mcp', shop: SHOP }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Shopify MCP Server corriendo — ${SHOP} — puerto ${PORT}`));
