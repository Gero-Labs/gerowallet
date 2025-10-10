import * as pako from 'pako';
import { debugLog } from '@/utils/debug';

interface MessageChunk {
  message_id: string;      // Unique ID for the complete message
  chunk_index: number;     // 0-based index of this chunk
  total_chunks: number;    // Total number of chunks for this message
  data: string;           // The chunk data (Base64 if compressed)
  compressed: boolean;     // Whether the data is GZIP compressed
  message_type: string;   // Original message type (e.g., "SYNC")
}

/**
 * Service to handle reconstruction of chunked messages from Ably
 * Supports GZIP decompression and multi-chunk message assembly
 */
export class MessageReconstructionService {
  private messageChunks = new Map<string, Map<number, MessageChunk>>();
  private timeouts = new Map<string, NodeJS.Timeout>();
  private readonly TIMEOUT_MS = 30000; // 30 seconds

  /**
   * Process a chunk and return the reconstructed message if complete
   * @param chunk - The message chunk to process
   * @returns The reconstructed message if all chunks received, null otherwise
   */
  processChunk(chunk: MessageChunk): any | null {
    // Clear existing timeout
    if (this.timeouts.has(chunk.message_id)) {
      clearTimeout(this.timeouts.get(chunk.message_id)!);
    }

    // Set new timeout
    this.timeouts.set(chunk.message_id, setTimeout(() => {
      console.warn('⏰ Message chunks timeout:', chunk.message_id);
      this.cleanupMessage(chunk.message_id);
    }, this.TIMEOUT_MS));

    // Store chunk
    if (!this.messageChunks.has(chunk.message_id)) {
      this.messageChunks.set(chunk.message_id, new Map());
    }

    const chunks = this.messageChunks.get(chunk.message_id)!;
    chunks.set(chunk.chunk_index, chunk);

    // Check if all chunks received
    if (chunks.size === chunk.total_chunks) {
      return this.reconstructMessage(chunk.message_id);
    }

    return null; // Still waiting for more chunks
  }

  /**
   * Reconstruct a complete message from all received chunks
   * @param messageId - The unique message ID
   * @returns The reconstructed and parsed message
   */
  private reconstructMessage(messageId: string): any {
    const chunks = this.messageChunks.get(messageId)!;
    const sortedChunks = Array.from(chunks.values())
      .sort((a, b) => a.chunk_index - b.chunk_index);

    // Combine data from all chunks
    let combinedData = sortedChunks.map(chunk => chunk.data).join('');

    // Decompress if needed
    if (sortedChunks[0].compressed) {
      try {
        combinedData = this.decompressData(combinedData);
      } catch (error: any) {
        console.error('❌ Decompression failed:', error);
        this.cleanupMessage(messageId);
        throw new Error(`Failed to decompress message ${messageId}: ${error.message}`);
      }
    }

    // Clean up
    this.cleanupMessage(messageId);

    try {
      return JSON.parse(combinedData);
    } catch (error: any) {
      console.error('❌ Failed to parse reconstructed message:', error);
      throw new Error(`Failed to parse reconstructed message ${messageId}: ${error.message}`);
    }
  }

  /**
   * Decompress Base64-encoded GZIP data
   * @param base64Data - Base64-encoded compressed data
   * @returns Decompressed string
   */
  private decompressData(base64Data: string): string {
    try {
      // Convert base64 to Uint8Array
      const compressed = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      // Decompress using pako
      return pako.ungzip(compressed, { to: 'string' });;
    } catch (error: any) {
      console.error('❌ GZIP decompression error:', error);
      throw new Error(`GZIP decompression failed: ${error.message}`);
    }
  }

  /**
   * Clean up message chunks and timeout for a given message ID
   * @param messageId - The message ID to clean up
   */
  private cleanupMessage(messageId: string): void {
    this.messageChunks.delete(messageId);
    if (this.timeouts.has(messageId)) {
      clearTimeout(this.timeouts.get(messageId)!);
      this.timeouts.delete(messageId);
    }
  }

  /**
   * Get current statistics about pending messages
   * @returns Object with pending message statistics
   */
  getPendingStats(): { pendingMessages: number; totalChunks: number } {
    let totalChunks = 0;
    this.messageChunks.forEach(chunks => {
      totalChunks += chunks.size;
    });

    return {
      pendingMessages: this.messageChunks.size,
      totalChunks
    };
  }

  /**
   * Clear all pending messages (useful for cleanup)
   */
  clearAll(): void {
    debugLog('🧹 Clearing all pending message chunks');

    // Clear all timeouts
    this.timeouts.forEach(timeout => clearTimeout(timeout));
    this.timeouts.clear();

    // Clear all message chunks
    this.messageChunks.clear();
  }
}

// Export singleton instance
export const messageReconstructionService = new MessageReconstructionService();
export default messageReconstructionService;
