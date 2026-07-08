from pydantic import BaseModel
from typing import Optional

class OrderCreate(BaseModel):
    makerAddress: str
    makerAmount: float
    makerToken: str
    takerAmount: float
    takerToken: str

class OrderResponse(BaseModel):
    id: str
    makerAddress: str
    makerAmount: float
    makerToken: str
    takerAmount: float
    takerToken: str
    timestamp: int
    status: str

class SwapRequest(BaseModel):
    fromToken: str
    toToken: str
    fromAmount: float
    toAddress: str
    slippage: float = 0.5

class SwapResponse(BaseModel):
    txId: str
    fromToken: str
    toToken: str
    fromAmount: float
    toAmount: float
    fee: float
    status: str

class BroadcastRequest(BaseModel):
    txJson: str

class HealthResponse(BaseModel):
    status: str
    network: str
    nodeConnected: bool
    orderCount: int
