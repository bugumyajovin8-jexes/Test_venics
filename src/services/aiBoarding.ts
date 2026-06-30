import { Type } from "@google/genai";
import { generateContent as generateContentViaProxy } from "./geminiProxy";

export interface ExtractedProduct {
  name: string;
  buy_price: number | string;
  stock: number | string;
  sell_price?: number | string; // Optional, might not be on receipts
  expiry_date?: string;
}

const productSchema = {
  type: Type.OBJECT,
  properties: {
    products: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Jina la bidhaa" },
          buy_price: { type: Type.NUMBER, description: "Bei ya kununulia kwa kipande kimoja" },
          stock: { type: Type.NUMBER, description: "Idadi iliyonunuliwa" },
          sell_price: { type: Type.NUMBER, description: "Bei ya kuuzia iliyopendekezwa (ikiwa ipo)" },
          expiry_date: { type: Type.STRING, description: "Tarehe ya kuisha matumizi YYYY-MM-DD (ikiwa ipo)" }
        },
        required: ["name", "buy_price", "stock"]
      }
    }
  },
  required: ["products"]
};

export interface AuditResult {
  product_id?: string;
  name: string;
  expected_stock: number;
  actual_stock: number;
  discrepancy: number;
  status: 'match' | 'missing' | 'extra';
}

const auditSchema = {
  type: Type.OBJECT,
  properties: {
    audits: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Jina la bidhaa inayotambulika" },
          actual_stock: { type: Type.NUMBER, description: "Idadi iliyohesabiwa kwenye picha" }
        },
        required: ["name", "actual_stock"]
      }
    }
  },
  required: ["audits"]
};

function translateGeminiError(error: any, defaultMsg: string): Error {
  console.error("Gemini AI Operation Error:", error);
  
  const errorMessage = error?.message || "";
  const errorMessageLower = errorMessage.toLowerCase();
  const errorCode = error?.status || error?.code || (error?.error?.code) || "";

  // 1. Safety Blocks
  if (
    errorMessageLower.includes("safety") || 
    errorMessageLower.includes("finishreason: safety") || 
    errorMessageLower.includes("blocked")
  ) {
    return new Error("Venics smart imekataa picha hii kwa sababu za kiusalama (pengine ina taarifa binafsi sana). Tafadhali jaribu picha nyingine au ufunike sehemu nyeti.");
  }

  // 2. Offline / Network Errors
  if (
    errorMessageLower.includes("network") || 
    errorMessageLower.includes("fetch") || 
    errorMessageLower.includes("offline") || 
    errorMessageLower.includes("failed to fetch")
  ) {
    return new Error("Inashindwa kuunganishwa kwenye intaneti. Tafadhali kagua mtandao wako na ujaribu tena.");
  }

  // 3. Unavailable / High Demand (503/500/etc.)
  if (
    errorMessageLower.includes("unavailable") || 
    errorMessageLower.includes("high demand") || 
    errorMessageLower.includes("spikes in demand") || 
    errorMessageLower.includes("temporary") ||
    errorMessageLower.includes("busy") ||
    errorMessageLower.includes("503") ||
    errorCode === 503 ||
    errorCode === 500
  ) {
    return new Error("Mfumo wa Venics Smart una unatumiwa sana kwa sasa. Tafadhali subiri sekunde chache na ujaribu tena.");
  }

  // 4. General Fallback for all other issues (including limits, invalid keys, rate limits)
  return new Error("Imeshindwa kusoma picha. Hakikisha maandishi yanaonekana vizuri na hakuna kivuli kikubwa.");
}

export async function auditProductsFromImage(base64Image: string, mimeType: string, currentInventory: {name: string, stock: number}[]): Promise<{name: string, actual_stock: number}[]> {
  try {
    const inventoryContext = currentInventory.map(i => `${i.name} (In system: ${i.stock})`).join(", ");

    const response = await generateContentViaProxy({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              text: `You are an expert inventory auditor. Analyze this photo of a shop's shelf or storage.
              
              Context of items currently in the system: [${inventoryContext}]
              
              Instructions:
              1. Count every single item visible on the shelf.
              2. Match the items found to the names provided in the context if possible.
              3. If you find items not in the context, list them by their clear names.
              4. Accuracy is critical. Count carefully, looking for patterns (e.g., rows of 6, stacks of 4).
              
              Output MUST be JSON format.`
            },
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: auditSchema
      }
    });

    if (!response.text) return [];
    const result = JSON.parse(response.text);
    return result.audits || [];
  } catch (error: any) {
    throw translateGeminiError(error, "Imeshindwa kufanya ukaguzi wa picha. Hakikisha picha inaonyesha rafu vizuri.");
  }
}

export async function extractProductsFromImage(base64Image: string, mimeType: string): Promise<ExtractedProduct[]> {
  try {
    const response = await generateContentViaProxy({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              text: `You are a professional retail digitizer for Tanzanian shops. 
              Objective: Analyze this photo of an invoice, handwritten list, receipts, or items on a shelf.
              Identify every product and extract:
              - Name: Corrected and clear Swahili or English name.
              - Buy Price: Unit purchase price (if total is shown, divide by quantity).
              - Quantity/Stock: Number of items.
              - Sell Price: If listed on the receipt, extract it. If not, set to null.
              - Expiry Date: If printed on the product or box, extract it as YYYY-MM-DD. Set to null if not found.

              Guidelines:
              - Handle currency symbols (TZS, Sh, /, etc.) and thousands separators (commas, spaces).
              - If it's a handwritten list, do your best to decipher it.
              - If no products are found, return an empty list.
              - Output MUST be JSON format.`
            },
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: productSchema
      }
    });

    if (!response.text) {
      throw new Error("AI haikuweza kutoa majibu yoyote kutoka kwenye picha hii.");
    }

    const result = JSON.parse(response.text);
    return result.products || [];
  } catch (error: any) {
    throw translateGeminiError(error, "Imeshindwa kusoma picha. Hakikisha maandishi yanaonekana vizuri na hakuna kivuli kikubwa.");
  }
}