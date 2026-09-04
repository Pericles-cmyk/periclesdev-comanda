create extension if not exists pgcrypto;
create sequence if not exists orders_order_number_seq start 1;
create table if not exists profiles(id uuid primary key default gen_random_uuid(),full_name text not null,login_name text not null unique,role text not null check(role in('waiter','admin')),active boolean not null default true,password_hash text not null,password_updated_at timestamptz,deleted_at timestamptz,created_at timestamptz not null default now());
create table if not exists sessions(token text primary key,user_id uuid not null references profiles(id) on delete cascade,expires_at timestamptz not null,created_at timestamptz not null default now());
create table if not exists categories(id uuid primary key default gen_random_uuid(),name text not null unique,active boolean not null default true,sort_order int not null default 0,created_at timestamptz not null default now());
create table if not exists products(id uuid primary key default gen_random_uuid(),category_id uuid not null references categories(id),name text not null,description text,base_price numeric(12,2),active boolean not null default true,stock_enabled boolean not null default false,stock_quantity numeric(12,0),low_stock_threshold numeric(12,0),sort_order int not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz);
create table if not exists product_variants(id uuid primary key default gen_random_uuid(),product_id uuid not null references products(id),name text not null,price numeric(12,2) not null,active boolean not null default true,sort_order int not null default 0);
create table if not exists restaurant_tables(id uuid primary key default gen_random_uuid(),number int not null unique,label text,status text not null default 'free' check(status in('free','occupied','disabled')),active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists orders(id uuid primary key default gen_random_uuid(),order_number bigint not null default nextval('orders_order_number_seq'),table_id uuid not null references restaurant_tables(id),status text not null default 'open' check(status in('open','closed','cancelled')),opened_by uuid references profiles(id),opened_at timestamptz not null default now(),closed_by uuid references profiles(id),closed_at timestamptz,discount_amount numeric(12,2) not null default 0,service_amount numeric(12,2) not null default 0,notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index if not exists one_open_order_per_table on orders(table_id) where status='open';
create table if not exists order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references orders(id) on delete cascade,product_id uuid references products(id),variant_id uuid references product_variants(id),product_name_snapshot text not null,variant_name_snapshot text,quantity int not null check(quantity>0),unit_price numeric(12,2) not null,notes text,status text not null default 'active' check(status in('active','cancelled')),added_by uuid references profiles(id),added_at timestamptz not null default now(),cancelled_by uuid references profiles(id),cancelled_at timestamptz,cancel_reason text);
create table if not exists payments(id uuid primary key default gen_random_uuid(),order_id uuid not null references orders(id) on delete cascade,method text not null check(method in('cash','pix','debit','credit')),amount numeric(12,2) not null check(amount>0),recorded_by uuid references profiles(id),created_at timestamptz not null default now());

insert into profiles(full_name,login_name,role,password_hash,password_updated_at) values
('Administrador','administrador','admin',crypt('12345678',gen_salt('bf')),now()) on conflict(login_name) do nothing;

insert into restaurant_tables(number,label)
select n,'Mesa '||n from generate_series(1,20)n on conflict(number) do nothing;

-- Cardápio propositalmente vazio na versão base.
-- Cadastre categorias, produtos, preços e variações pelo Painel Admin
-- ou substitua este trecho por um seed SQL específico do cliente.

create table if not exists backup_settings(
  id integer primary key default 1 check(id=1),
  enabled boolean not null default true,
  frequency text not null default 'daily' check(frequency in('daily','weekly','monthly')),
  weekdays integer[] not null default array[1,2,3,4,5,6,0],
  monthly_day integer not null default 1 check(monthly_day between 1 and 28),
  backup_time text not null default '03:00',
  destination_path text not null default '',
  keep_count integer not null default 14,
  last_backup_at timestamptz,
  last_status text,
  last_message text,
  last_file text,
  updated_at timestamptz not null default now()
);
