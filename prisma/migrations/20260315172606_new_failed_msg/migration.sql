-- CreateTable
CREATE TABLE "failed_order_messages" (
    "messageId" DOUBLE PRECISION NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_order_messages_pkey" PRIMARY KEY ("messageId")
);
