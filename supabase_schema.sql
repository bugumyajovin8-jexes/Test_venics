-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL,
  details jsonb,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  user_name text,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.broadcast_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  target_role text DEFAULT 'all'::text,
  created_at timestamp with time zone DEFAULT now(),
  sent_at timestamp with time zone,
  status text DEFAULT 'pending'::text,
  target_ids ARRAY,
  CONSTRAINT broadcast_messages_pkey PRIMARY KEY (id)
);
CREATE TABLE public.debt_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  sale_id uuid,
  amount double precision NOT NULL,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT debt_payments_pkey PRIMARY KEY (id),
  CONSTRAINT debt_payments_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT debt_payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id)
);
CREATE TABLE public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid,
  amount double precision NOT NULL,
  category text NOT NULL,
  description text,
  date timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT expenses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.features (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  feature_key text NOT NULL,
  is_enabled boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT features_pkey PRIMARY KEY (id),
  CONSTRAINT features_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);
CREATE TABLE public.licenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  status text DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'blocked'::text])),
  expiry_date timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT licenses_pkey PRIMARY KEY (id),
  CONSTRAINT licenses_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);
CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  name text NOT NULL,
  buy_price double precision NOT NULL,
  sell_price double precision NOT NULL,
  stock double precision DEFAULT 0,
  min_stock double precision DEFAULT 0,
  unit text DEFAULT 'pcs'::text,
  batches jsonb DEFAULT '[]'::jsonb,
  notify_expiry_days integer DEFAULT 30,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);
CREATE TABLE public.sale_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid,
  shop_id uuid NOT NULL,
  product_id uuid,
  product_name text NOT NULL,
  qty double precision NOT NULL,
  buy_price double precision NOT NULL,
  sell_price double precision NOT NULL,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sale_items_pkey PRIMARY KEY (id),
  CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id),
  CONSTRAINT sale_items_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid,
  total_amount double precision NOT NULL,
  total_profit double precision NOT NULL,
  payment_method text CHECK (payment_method = ANY (ARRAY['cash'::text, 'mobile_money'::text, 'credit'::text])),
  status text DEFAULT 'completed'::text CHECK (status = ANY (ARRAY['completed'::text, 'cancelled'::text, 'refunded'::text, 'pending'::text])),
  customer_name text,
  customer_phone text,
  due_date timestamp with time zone,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sales_pkey PRIMARY KEY (id),
  CONSTRAINT sales_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT sales_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.shop_invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'employee'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT shop_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT shop_invitations_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);
CREATE TABLE public.shops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_name text,
  phone text,
  whatsapp_phone text,
  status text DEFAULT 'active'::text,
  enable_expiry boolean DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT shops_pkey PRIMARY KEY (id),
  CONSTRAINT shops_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  shop_id uuid,
  email text NOT NULL,
  name text NOT NULL,
  phone text,
  role text CHECK (role = ANY (ARRAY['boss'::text, 'employee'::text, 'admin'::text, 'staff'::text, 'superadmin'::text, 'manager'::text, 'cashier'::text])),
  status text DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'blocked'::text])),
  last_seen timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  fcm_token text,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT users_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);

CREATE TABLE public.saas_telemetry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid,
  user_name text,
  feature_key text NOT NULL,
  details jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT saas_telemetry_pkey PRIMARY KEY (id),
  CONSTRAINT saas_telemetry_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT saas_telemetry_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);