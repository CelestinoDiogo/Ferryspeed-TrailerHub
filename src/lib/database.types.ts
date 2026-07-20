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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};