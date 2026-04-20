--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3 (Debian 18.3-1.pgdg13+1)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: chat_channel_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channel_members (
    id integer NOT NULL,
    channel_id text NOT NULL,
    user_id integer NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    joined_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_read_at timestamp(3) without time zone,
    muted boolean DEFAULT false NOT NULL
);


--
-- Name: chat_channel_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_channel_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_channel_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_channel_members_id_seq OWNED BY public.chat_channel_members.id;


--
-- Name: chat_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channels (
    id text NOT NULL,
    type character varying(20) NOT NULL,
    name character varying(255),
    topic character varying(500),
    admin_task_id integer,
    created_by integer,
    last_message_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id text NOT NULL,
    channel_id text NOT NULL,
    sender_id integer,
    sender_type character varying(20) DEFAULT 'user'::character varying NOT NULL,
    sender_label character varying(255),
    content text NOT NULL,
    attachments jsonb,
    edited_at timestamp(3) without time zone,
    deleted_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id text NOT NULL,
    user_id integer NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    body text,
    link character varying(500),
    meta jsonb,
    read_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: overtime_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.overtime_requests (
    id integer NOT NULL,
    person_id integer NOT NULL,
    hours numeric(5,2) NOT NULL,
    type character varying(50) NOT NULL,
    note text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    approved_by integer,
    month character varying(7) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: overtime_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.overtime_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: overtime_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.overtime_requests_id_seq OWNED BY public.overtime_requests.id;


--
-- Name: chat_channel_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_members ALTER COLUMN id SET DEFAULT nextval('public.chat_channel_members_id_seq'::regclass);


--
-- Name: overtime_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overtime_requests ALTER COLUMN id SET DEFAULT nextval('public.overtime_requests_id_seq'::regclass);


--
-- Name: chat_channel_members chat_channel_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_pkey PRIMARY KEY (id);


--
-- Name: chat_channels chat_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: overtime_requests overtime_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overtime_requests
    ADD CONSTRAINT overtime_requests_pkey PRIMARY KEY (id);


--
-- Name: chat_channel_members_channel_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_channel_members_channel_id_user_id_key ON public.chat_channel_members USING btree (channel_id, user_id);


--
-- Name: chat_channel_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_channel_members_user_id_idx ON public.chat_channel_members USING btree (user_id);


--
-- Name: chat_channels_admin_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_channels_admin_task_id_idx ON public.chat_channels USING btree (admin_task_id);


--
-- Name: chat_channels_last_message_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_channels_last_message_at_idx ON public.chat_channels USING btree (last_message_at);


--
-- Name: chat_channels_type_admin_task_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_channels_type_admin_task_id_key ON public.chat_channels USING btree (type, admin_task_id);


--
-- Name: chat_channels_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_channels_type_idx ON public.chat_channels USING btree (type);


--
-- Name: chat_messages_channel_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_channel_id_created_at_idx ON public.chat_messages USING btree (channel_id, created_at);


--
-- Name: chat_messages_sender_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_sender_id_idx ON public.chat_messages USING btree (sender_id);


--
-- Name: notifications_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_created_at_idx ON public.notifications USING btree (created_at);


--
-- Name: notifications_user_id_read_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_read_at_idx ON public.notifications USING btree (user_id, read_at);


--
-- Name: overtime_requests_person_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX overtime_requests_person_id_idx ON public.overtime_requests USING btree (person_id);


--
-- Name: overtime_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX overtime_requests_status_idx ON public.overtime_requests USING btree (status);


--
-- Name: chat_channel_members chat_channel_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_channel_members chat_channel_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_channels chat_channels_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: overtime_requests overtime_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overtime_requests
    ADD CONSTRAINT overtime_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.people(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: overtime_requests overtime_requests_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.overtime_requests
    ADD CONSTRAINT overtime_requests_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

