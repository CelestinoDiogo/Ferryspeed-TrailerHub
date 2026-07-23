export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      trailers: {
        Row: {
          id: string;
          trailer_number: string | null;
          trailer_type: string | null;
          load_status: string | null;
          load_description: string | null;
          customer: string | null;
          consignee: string | null;
          container_number: string | null;
          compound_position: string | null;
          arrival_date: string | null;
          departure_date: string | null;
          departure_time: string | null;
          notes: string | null;
          created_at: string | null;
          trailer_source: string | null;
          external_company: string | null;
          external_reference: string | null;
          is_local: boolean | null;
          operational_status: string | null;
          source_vessel_operation_trailer_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["trailers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["trailers"]["Row"]>;
        Relationships: [];
      };
      app_roles: {
        Row: {
          role_key: string;
          label: string;
          description: string | null;
          is_system: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["app_roles"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["app_roles"]["Row"]>;
        Relationships: [];
      };
      app_permission_modules: {
        Row: {
          module_key: string;
          label: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["app_permission_modules"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["app_permission_modules"]["Row"]>;
        Relationships: [];
      };
      app_role_permissions: {
        Row: {
          role_key: string;
          module_key: string;
          can_view: boolean;
          can_create: boolean;
          can_edit: boolean;
          can_delete: boolean;
          can_reports: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["app_role_permissions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["app_role_permissions"]["Row"]>;
        Relationships: [];
      };
      app_user_roles: {
        Row: {
          user_id: string;
          email: string | null;
          display_name: string | null;
          role_key: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["app_user_roles"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["app_user_roles"]["Row"]>;
        Relationships: [];
      };
      company_trailers: {
        Row: {
          id: string;
          trailer_number: string | null;
          prefix: string | null;
          numeric_part: number | null;
          trailer_type: string | null;
          notes: string | null;
          original_value: string | null;
          active: boolean | null;
          created_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["company_trailers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["company_trailers"]["Row"]>;
        Relationships: [];
      };
      trailer_events: {
        Row: {
          id: string;
          trailer_id: string | null;
          trailer_number: string | null;
          event_type: string | null;
          event_description: string | null;
          old_value: Json | null;
          new_value: Json | null;
          created_at: string | null;
          created_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["trailer_events"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["trailer_events"]["Row"]>;
        Relationships: [];
      };
      trailer_audit_log: {
        Row: {
          id: string;
          trailer_id: string | null;
          trailer_number: string | null;
          event_type: string;
          description: string | null;
          previous_value: Json | null;
          new_value: Json | null;
          source_module: string | null;
          performed_by: string | null;
          performed_at: string | null;
          created_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["trailer_audit_log"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["trailer_audit_log"]["Row"]>;
        Relationships: [];
      };
      delivery_bookings: {
        Row: {
          id: string;
          trailer_id: string;
          delivery_date: string;
          delivery_time: string | null;
          customer: string | null;
          consignee: string | null;
          delivery_location: string | null;
          booking_reference: string | null;
          escort_required: boolean | null;
          status: string;
          notes: string | null;
          created_at: string | null;
          updated_at: string | null;
          delivered_at: string | null;
          waiting_collection_since: string | null;
          collection_due_date: string | null;
          collected_at: string | null;
          demurrage_free_days: number | null;
          demurrage_daily_rate: number | null;
          demurrage_currency: string | null;
          demurrage_notes: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["delivery_bookings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["delivery_bookings"]["Row"]>;
        Relationships: [];
      };
      export_allocations: {
        Row: {
          id: string;
          trailer_id: string;
          trailer_number: string | null;
          customer: string | null;
          collection_address: string | null;
          haulier: string | null;
          booking_reference: string | null;
          load_type: string | null;
          collection_date: string | null;
          collection_time: string | null;
          expected_return_at: string | null;
          priority: string | null;
          status: string;
          notes: string | null;
          allocated_at: string | null;
          delivered_empty_at: string | null;
          waiting_loading_at: string | null;
          collected_loaded_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          collected_by_haulier_at: string | null;
          loading_started_at: string | null;
          loaded_at: string | null;
          returned_at: string | null;
          shipped_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["export_allocations"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["export_allocations"]["Row"]>;
        Relationships: [];
      };
      compound_stock_checks: {
        Row: {
          id: string;
          status: string;
          started_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          started_by: string | null;
          completed_by: string | null;
          expected_total: number | null;
          checked_total: number | null;
          present_total: number | null;
          missing_total: number | null;
          unexpected_total: number | null;
          wrong_position_total: number | null;
          wrong_status_total: number | null;
          notes: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["compound_stock_checks"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["compound_stock_checks"]["Row"]>;
        Relationships: [];
      };
      compound_stock_check_items: {
        Row: {
          id: string;
          stock_check_id: string;
          trailer_id: string | null;
          trailer_number: string | null;
          expected_in_compound: boolean | null;
          physically_present: boolean | null;
          expected_position: string | null;
          actual_position: string | null;
          system_load_status: string | null;
          system_operational_status: string | null;
          discrepancy_type: string | null;
          checked_at: string | null;
          checked_by: string | null;
          resolution_status: string | null;
          resolution_action: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          notes: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["compound_stock_check_items"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["compound_stock_check_items"]["Row"]>;
        Relationships: [];
      };
      vessel_operations: {
        Row: {
          id: string;
          vessel_name: string | null;
          sailing_reference: string | null;
          origin_port: string | null;
          berth: string | null;
          expected_arrival_at: string | null;
          actual_arrival_at: string | null;
          status: string;
          list_status: string;
          list_confirmed_at: string | null;
          list_confirmed_by: string | null;
          notes: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["vessel_operations"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["vessel_operations"]["Row"]>;
        Relationships: [];
      };
      vessel_operation_trailers: {
        Row: {
          id: string;
          vessel_operation_id: string;
          trailer_id: string | null;
          trailer_number: string | null;
          customer: string | null;
          booking_reference: string | null;
          load_status: string | null;
          load_description: string | null;
          temperature_required: string | null;
          expected_front_temperature: number | null;
          expected_rear_temperature: number | null;
          expected_temperature_unit: string | null;
          priority_level: string | null;
          priority_reason: string | null;
          planned_destination: string | null;
          planning_notes: string | null;
          status: string | null;
          arrived_at: string | null;
          arrival_status: string;
          arrival_confirmed_at: string | null;
          arrival_record_id: string | null;
          arrival_confirmed_by: string | null;
          inspection_started_at: string | null;
          inspection_completed_at: string | null;
          position_assigned_at: string | null;
          assigned_position: string | null;
          has_damage: boolean | null;
          has_temperature_alert: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["vessel_operation_trailers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["vessel_operation_trailers"]["Row"]>;
        Relationships: [];
      };
      vessel_inspection_damages: {
        Row: {
          id: string;
          vessel_trailer_id: string | null;
          trailer_id: string | null;
          trailer_number: string | null;
          vessel_operation_id: string | null;
          damage_type: string | null;
          damage_location: string | null;
          severity: string | null;
          description: string | null;
          recorded_at: string | null;
          recorded_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["vessel_inspection_damages"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["vessel_inspection_damages"]["Row"]>;
        Relationships: [];
      };
      vessel_inspection_temperatures: {
        Row: {
          id: string;
          vessel_trailer_id: string | null;
          trailer_id: string | null;
          trailer_number: string | null;
          temperature_value: number | null;
          temperature_unit: string | null;
          reading_point: string | null;
          notes: string | null;
          is_out_of_range: boolean | null;
          recorded_at: string | null;
          recorded_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["vessel_inspection_temperatures"]["Row"]>;
        Relationships: [];
      };
      vessel_inspection_photos: {
        Row: {
          id: string;
          vessel_trailer_id: string | null;
          vessel_operation_id: string | null;
          category: string | null;
          storage_path: string | null;
          file_name: string | null;
          description: string | null;
          uploaded_at: string | null;
          uploaded_by: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["vessel_inspection_photos"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["vessel_inspection_photos"]["Row"]>;
        Relationships: [];
      };
      vessel_operation_reports: {
        Row: {
          id: string;
          vessel_operation_id: string;
          report_type: string;
          report_status: string;
          report_number: string | null;
          title: string;
          subject: string | null;
          recipients: string[];
          cc: string[];
          executive_summary: string | null;
          operational_analysis: string | null;
          recommendations: string | null;
          conclusion: string | null;
          generated_content: string | null;
          edited_content: string | null;
          structured_snapshot: Json;
          structured_data_snapshot: Json;
          generated_by_ai: boolean;
          ai_model: string | null;
          generated_at: string | null;
          generated_by: string | null;
          approved_at: string | null;
          approved_by: string | null;
          sent_at: string | null;
          sent_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["vessel_operation_reports"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["vessel_operation_reports"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      confirm_vessel_operation_list: {
        Args: { p_vessel_operation_id: string; p_confirmed_by?: string | null };
        Returns: Database["public"]["Tables"]["vessel_operations"]["Row"];
      };
      reopen_vessel_operation_list: {
        Args: { p_vessel_operation_id: string; p_reopened_by?: string | null };
        Returns: Database["public"]["Tables"]["vessel_operations"]["Row"];
      };
      confirm_vessel_trailer_arrival: {
        Args: {
          p_vessel_operation_trailer_id: string;
          p_received_at?: string | null;
          p_compound_position?: string | null;
          p_arrival_notes?: string | null;
          p_condition_on_arrival?: string | null;
          p_confirmed_by?: string | null;
        };
        Returns: string;
      };
      start_compound_stock_check: {
        Args: { p_started_by: string };
        Returns: Database["public"]["Tables"]["compound_stock_checks"]["Row"][];
      };
      mark_compound_stock_check_present: {
        Args: { p_stock_check_id: string; p_trailer_number: string; p_checked_by: string };
        Returns: {
          stock_check_id: string;
          stock_check_item_id: string | null;
          trailer_number: string;
          result: "marked_present" | "already_present" | "unexpected";
          checked_total: number | null;
          present_total: number | null;
          expected_total: number | null;
          remaining_total: number | null;
        }[];
      };
      change_stock_check_trailer_load_status: {
        Args: {
          p_stock_check_id: string;
          p_stock_check_item_id: string;
          p_new_load_status: string;
          p_changed_by: string;
        };
        Returns: {
          stock_check_item_id: string;
          trailer_id: string;
          trailer_number: string;
          previous_load_status: string | null;
          new_load_status: string | null;
          discrepancy_type: string | null;
          resolution_status: string | null;
        }[];
      };
      change_stock_check_trailer_position: {
        Args: {
          p_stock_check_id: string;
          p_stock_check_item_id: string;
          p_new_position: string;
          p_changed_by: string;
        };
        Returns: {
          stock_check_item_id: string;
          trailer_id: string;
          trailer_number: string;
          previous_position: string | null;
          new_position: string | null;
          discrepancy_type: string | null;
          resolution_status: string | null;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};