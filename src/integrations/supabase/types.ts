export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_config: {
        Row: {
          id: number
          pass_hash: string
          updated_at: string
        }
        Insert: {
          id?: number
          pass_hash: string
          updated_at?: string
        }
        Update: {
          id?: number
          pass_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      note_shares: {
        Row: {
          created_at: string
          slug: string
          token: string
        }
        Insert: {
          created_at?: string
          slug: string
          token: string
        }
        Update: {
          created_at?: string
          slug?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_shares_slug_fkey"
            columns: ["slug"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["slug"]
          },
        ]
      }
      capability_admission_windows: {
        Row: {
          bucket_kind: string
          byte_count: number
          operation: string
          request_count: number
          subject_hash: string
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_kind: string
          byte_count: number
          operation: string
          request_count: number
          subject_hash: string
          updated_at?: string
          window_start: string
        }
        Update: {
          bucket_kind?: string
          byte_count?: number
          operation?: string
          request_count?: number
          subject_hash?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      capability_runtime_settings: {
        Row: {
          private_realtime_enabled: boolean
          singleton: boolean
          updated_at: string
          writes_enabled: boolean
        }
        Insert: {
          private_realtime_enabled?: boolean
          singleton?: boolean
          updated_at?: string
          writes_enabled?: boolean
        }
        Update: {
          private_realtime_enabled?: boolean
          singleton?: boolean
          updated_at?: string
          writes_enabled?: boolean
        }
        Relationships: []
      }
      note_capabilities: {
        Row: {
          capability_id: string
          created_at: string
          generation: number
          last_used_at: string | null
          note_id: string
          revoked_at: string | null
          scope: Database["public"]["Enums"]["note_capability_scope"]
          token_hash: string
        }
        Insert: {
          capability_id?: string
          created_at?: string
          generation?: number
          last_used_at?: string | null
          note_id: string
          revoked_at?: string | null
          scope: Database["public"]["Enums"]["note_capability_scope"]
          token_hash: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          generation?: number
          last_used_at?: string | null
          note_id?: string
          revoked_at?: string | null
          scope?: Database["public"]["Enums"]["note_capability_scope"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_capabilities_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
        ]
      }
      note_checkpoints: {
        Row: {
          checkpoint_id: string
          created_at: string
          encryption_version: number
          note_id: string
          payload: string
          through_seq: number
          version: number
        }
        Insert: {
          checkpoint_id: string
          created_at?: string
          encryption_version: number
          note_id: string
          payload: string
          through_seq: number
          version: number
        }
        Update: {
          checkpoint_id?: string
          created_at?: string
          encryption_version?: number
          note_id?: string
          payload?: string
          through_seq?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_checkpoints_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
        ]
      }
      note_updates: {
        Row: {
          created_at: string
          encryption_version: number
          note_id: string
          payload: string
          seq: number
          update_id: string
        }
        Insert: {
          created_at?: string
          encryption_version: number
          note_id: string
          payload: string
          seq?: never
          update_id: string
        }
        Update: {
          created_at?: string
          encryption_version?: number
          note_id?: string
          payload?: string
          seq?: never
          update_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_updates_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
        ]
      }
      notes: {
        Row: {
          capability_managed: boolean
          char_count: number
          checkpoint_limit_count: number
          content: string
          created_at: string
          deleted_at: string | null
          enc_check: string | null
          enc_iterations: number
          enc_salt: string | null
          encryption_version: number
          is_encrypted: boolean
          note_id: string
          payload_limit_bytes: number
          slug: string
          storage_limit_bytes: number
          sync_status: Database["public"]["Enums"]["note_sync_status"]
          tags: string[]
          update_limit_count: number
          updated_at: string
          ydoc_state: string
        }
        Insert: {
          capability_managed?: boolean
          char_count?: number
          checkpoint_limit_count?: number
          content?: string
          created_at?: string
          deleted_at?: string | null
          enc_check?: string | null
          enc_iterations?: number
          enc_salt?: string | null
          encryption_version?: number
          is_encrypted?: boolean
          note_id?: string
          payload_limit_bytes?: number
          slug: string
          storage_limit_bytes?: number
          sync_status?: Database["public"]["Enums"]["note_sync_status"]
          tags?: string[]
          update_limit_count?: number
          updated_at?: string
          ydoc_state?: string
        }
        Update: {
          capability_managed?: boolean
          char_count?: number
          checkpoint_limit_count?: number
          content?: string
          created_at?: string
          deleted_at?: string | null
          enc_check?: string | null
          enc_iterations?: number
          enc_salt?: string | null
          encryption_version?: number
          is_encrypted?: boolean
          note_id?: string
          payload_limit_bytes?: number
          slug?: string
          storage_limit_bytes?: number
          sync_status?: Database["public"]["Enums"]["note_sync_status"]
          tags?: string[]
          update_limit_count?: number
          updated_at?: string
          ydoc_state?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      capability_admission_consume: {
        Args: {
          p_byte_cost?: number
          p_operation: "create" | "sync"
          p_request_cost?: number
          p_subject_hash: string
        }
        Returns: boolean
      }
      capability_note_create: {
        Args: {
          p_edit_token_hash: string
          p_owner_token_hash: string
          p_slug: string
          p_view_token_hash: string
        }
        Returns: Json
      }
      capability_note_manage: {
        Args: { p_action: string; p_params?: Json; p_token_hash: string }
        Returns: Json
      }
      capability_payload_audit: {
        Args: { p_soft_limit?: number }
        Returns: {
          max_checkpoint_bytes: number
          max_legacy_snapshot_bytes: number
          max_update_bytes: number
          notes_above_limit: number
          total_notes: number
        }[]
      }
      capability_quarantine_oversized: { Args: never; Returns: number }
      capability_runtime_set: {
        Args: {
          p_private_realtime_enabled: boolean
          p_writes_enabled: boolean
        }
        Returns: Json
      }
      capability_runtime_state: { Args: never; Returns: Json }
      capability_session_open: {
        Args: { p_after_seq?: number; p_limit?: number; p_token_hash: string }
        Returns: Json
      }
      capability_updates_append: {
        Args: {
          p_expected_encryption_version: number
          p_token_hash: string
          p_updates: Json
        }
        Returns: Json
      }
      legacy_share_rotate: {
        Args: { p_slug: string; p_token: string }
        Returns: boolean
      }
    }
    Enums: {
      note_capability_scope: "owner" | "edit" | "view"
      note_sync_status: "legacy" | "active" | "read_only_quarantine" | "deleted"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      note_capability_scope: ["owner", "edit", "view"],
      note_sync_status: ["legacy", "active", "read_only_quarantine", "deleted"],
    },
  },
} as const
