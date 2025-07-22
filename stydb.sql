--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5

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
-- Name: Beat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Beat" (
    id integer NOT NULL,
    title text NOT NULL,
    filename text NOT NULL,
    "userId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    description text,
    signature text NOT NULL,
    tempo integer NOT NULL
);


ALTER TABLE public."Beat" OWNER TO postgres;

--
-- Name: Beat_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Beat_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Beat_id_seq" OWNER TO postgres;

--
-- Name: Beat_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Beat_id_seq" OWNED BY public."Beat".id;


--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id integer NOT NULL,
    username text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: User_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."User_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."User_id_seq" OWNER TO postgres;

--
-- Name: User_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."User_id_seq" OWNED BY public."User".id;


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Name: Beat id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Beat" ALTER COLUMN id SET DEFAULT nextval('public."Beat_id_seq"'::regclass);


--
-- Name: User id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User" ALTER COLUMN id SET DEFAULT nextval('public."User_id_seq"'::regclass);


--
-- Data for Name: Beat; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Beat" (id, title, filename, "userId", "createdAt", description, signature, tempo) FROM stdin;
5	ZOUK JM	ZOUK_JM.sty	2	2025-07-15 04:45:41.436	ZOUK JM RIEN DU TOUT	4/4	100
6	4-4 EYO	4-4_EYO.sty	2	2025-07-15 18:17:39.554	EYO	4/4	130
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, username, email, password, "createdAt") FROM stdin;
1	EVRARD	kodia.evrard@gmail.com	$2b$10$p8CoHnoo95pQL.QyLD04v.tfVrXfny/JGP3Q8YYb/ZN6f6VKEUBo2	2025-07-14 15:08:18.008
2	evrard kodia	partitionpsrmanager@gmail.com	$2b$10$okEKK5P10HTfvC4edbsqZeUIgGRORM645l3KrpAwggpBQW54Sp7Xe	2025-07-14 15:09:22.825
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
328e991d-7369-468f-9490-5801ca46965f	3be40f0d0af793bc9b4b3ca2de368f2383c7fffa7d4f4f9f64e211f6f42c3a77	2025-07-13 21:48:10.976519+00	20250713214810_init	\N	\N	2025-07-13 21:48:10.958983+00	1
0de0146e-0ad7-4c36-a197-206fdbe56f12	9e5fba229df5846ed3bcf51d9917de26df838cd5e02e211d321a273fb86b59c7	2025-07-14 18:04:46.44211+00	20250714180446_add_tempo_description_signature	\N	\N	2025-07-14 18:04:46.435587+00	1
\.


--
-- Name: Beat_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Beat_id_seq"', 6, true);


--
-- Name: User_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."User_id_seq"', 2, true);


--
-- Name: Beat Beat_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Beat"
    ADD CONSTRAINT "Beat_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_username_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);


--
-- Name: Beat Beat_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Beat"
    ADD CONSTRAINT "Beat_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

