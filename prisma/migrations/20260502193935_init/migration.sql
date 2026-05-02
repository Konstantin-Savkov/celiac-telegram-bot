-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT DEFAULT '',
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general_info" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "general_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allowed_products" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT DEFAULT '',

    CONSTRAINT "allowed_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forbidden_products" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT DEFAULT '',
    "reason" TEXT DEFAULT '',

    CONSTRAINT "forbidden_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_checklist" (
    "id" SERIAL NOT NULL,
    "item" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tips" TEXT DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shopping_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_product_posts" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "username" TEXT DEFAULT '',
    "product_name" TEXT NOT NULL,
    "description" TEXT DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moderated_at" TIMESTAMP(3),
    "moderator_id" BIGINT,

    CONSTRAINT "safe_product_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "username" TEXT DEFAULT '',
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");
