Đây là bản Executive Summary mà mình đề xuất. Nếu mục tiêu là xây dựng một AI-Native QA Platform dựa trên Screenplay Pattern, thì 6 Runner này là đủ để bao phủ gần như toàn bộ vòng đời QA.

| Runner                            | Mục tiêu                                                      | Đối tượng sử dụng                               | Khả năng chính                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API Runner**                    | Kiểm thử Functional API (REST, gRPC, GraphQL) và E2E API Flow | Manual Tester, QA Engineer, Automation Engineer | **Simple Mode:** Test từng API, E2E Flow, Screenplay đơn giản (Actor → Ability → Task → Interaction → Question), Request Builder, Extract Variables, Assertions, Debug.<br>**Advanced Mode:** Screenplay Builder đầy đủ, reusable Actor/Ability/Task/Interaction/Question, Conditions, Retry, Polling, Loop, Parallel, Hooks, Data-driven, Test Suite, Code Generation, CI/CD.<br>**GUI:** REST (Method, URL, Headers, Body, Extract, Questions), gRPC (Host, Service, Method, Proto, Metadata, Streaming), GraphQL (Query, Mutation, Variables, Response). |
| **UI Runner**                     | Kiểm thử Web/Mobile UI và E2E UI Flow                         | Manual Tester, QA Engineer, Automation Engineer | **Simple Mode:** Screenplay đơn giản, Record/Playback, Click, Input, Upload, Assertions, Screenshot, Video, Debug.<br>**Advanced Mode:** Screenplay Automation, reusable UI Tasks, Conditions, Retry, Polling, Parallel, Hooks, Data-driven, Test Suite, Code Generation, CI/CD.<br>**GUI:** Browser/Mobile Preview, Element Inspector, Object Repository, Screenplay Panel, Flow Designer, Execution Timeline.                                                                                                                                             |
| **Database + Kafka/Redis Runner** | Kiểm tra Side Effects sau khi API/UI thực thi                 | Automation Engineer, Backend QA                 | **Database:** Execute SQL, Verify Record, Compare Data, Setup/Cleanup Test Data, Rollback.<br>**Kafka/MQ:** Publish, Consume, Verify Event, Header, Payload, DLQ.<br>**Redis:** Verify Cache, Session, TTL, Cache Invalidation.<br>Dùng như **External Questions** trong Screenplay.                                                                                                                                                                                                                                                                        |
| **AI Runner**                     | Hỗ trợ AI trong toàn bộ quy trình QA và Automation            | QA Engineer, QA Lead, Automation Engineer       | **Simple Mode:** Sinh API request, Actor, Ability, Task, Questions, Extract Rules, Dependency Mapping, E2E Flow, Negative Test, Boundary Test, Failure Analysis.<br>**Advanced Mode:** Sinh reusable Screenplay Components, Review Automation, Detect Duplicate Tasks, Generate Test Data, Review Coverage, Generate Code (Java, TS), Convert Functional Flow → K6 Scenario, AI Review.                                                                                                                                                                     |
| **Incident Runner**               | Thu thập bằng chứng và phân tích sự cố                        | QA Lead, SRE, Dev, Automation Engineer          | Thu thập API Request/Response, Screenshot, Video, Trace, Logs, Metrics, Database State, Kafka Events, Redis Cache, Execution Context, K6 Report. Sinh Timeline, Incident Report, Suggested Root Cause, Similar Incident, Jira Ticket.                                                                                                                                                                                                                                                                                                                       |
| **Performance K6 Runner**         | Kiểm thử hiệu năng và SLA/SLO                                 | Performance Engineer, Automation Engineer       | **Tái sử dụng trực tiếp** API hoặc E2E Flow từ API Runner.<br>Hỗ trợ Smoke, Load, Stress, Spike, Soak Test.<br>Cấu hình VUs, Arrival Rate, Ramp-up, Duration, Think Time, Thresholds.<br>Metrics: p90/p95/p99, Throughput, Error Rate, Flow Duration.<br>GUI: Chọn Source (Single API/E2E Flow), Load Profile, Data Strategy, Thresholds, K6 Script Preview, Result Dashboard.                                                                                                                                                                              |
Kiến trúc tổng thể
                         Screenplay Engine
                                  │
                   Reusable Test Repository
                                  │
      ┌──────────────┬────────────┼──────────────┬──────────────┐
      │              │            │              │              │
 API Runner     UI Runner    DB/Event Runner   AI Runner   Performance Runner
      │              │            │              │              │
      └──────────────┴────────────┴──────────────┴──────────────┘
                                  │
                           Incident Runner
Luồng sử dụng điển hình
Requirement
      │
      ▼
AI Runner
(Generate Test Assets)
      │
      ▼
API Runner / UI Runner
(Functional Testing)
      │
      ▼
Database + Kafka/Redis Runner
(Verify Side Effects)
      │
      ▼
Performance K6 Runner
(Reuse Functional Flow for Load Testing)
      │
      ▼
Incident Runner
(Collect Evidence & RCA if Failure)
Giá trị của kiến trúc
Thiết kế một lần, tái sử dụng nhiều lần: API, UI và E2E Flow được định nghĩa một lần rồi dùng cho Functional, Performance và Incident.
Screenplay Pattern xuyên suốt: Tất cả Runner đều sử dụng cùng mô hình Actor → Ability → Task → Interaction → Question, giảm trùng lặp và tăng khả năng tái sử dụng.
Hai mức trải nghiệm: Simple Mode giúp tester thao tác nhanh bằng GUI, Advanced Mode mở rộng thành automation framework hoàn chỉnh với data-driven, code generation và CI/CD.
AI là trợ lý, không thay thế execution: AI hỗ trợ sinh, review và tối ưu test assets; việc thực thi vẫn do các Runner chuyên trách đảm nhiệm.
Performance và Incident tận dụng Functional Assets: K6 không cần định nghĩa lại API/Flow, còn Incident Runner sử dụng toàn bộ execution context để phân tích và tạo báo cáo. Điều này giúp toàn bộ nền tảng có một nguồn dữ liệu thống nhất thay vì nhiều mô hình riêng biệt.
Tổng hợp chi tiết các Runner

Toàn bộ nền tảng dùng chung mô hình Screenplay:

Actor
→ Ability
→ Task
→ Interaction
→ Question

Các Runner dùng chung một nguồn dữ liệu:

API/UI Assets
E2E Flows
Test Data
Variables
Environment
Secrets
Execution Context
Questions
Reports
1. API Runner
Mục tiêu

Kiểm thử functional cho:

REST
gRPC

Hỗ trợ cả:

Single API Test
End-to-End API Flow

API trước có thể extract output và lưu lại làm input cho API sau.

Ví dụ:

Login
→ save accessToken

Create Payment
→ use accessToken
→ save paymentId

Get Payment Status
→ use paymentId
→ verify status
Đối tượng sử dụng
Manual Tester
QA Engineer
Automation Engineer
Backend QA
Developer
Khả năng chính
Import OpenAPI, cURL, Postman Collection.
Import .proto cho gRPC.
Test từng API riêng.
Ghép API thành E2E flow.
Extract và reuse variables.
Authentication.
Assertions/Questions.
Retry, polling, timeout.
Data-driven testing.
Test suite.
Tích hợp DB, Kafka và Redis.
Tái sử dụng asset cho K6.
Sinh automation code.
CI/CD execution.
1.1 API Runner — Simple Mode

Simple Mode phù hợp cho manual tester nhưng vẫn hiển thị trực tiếp Screenplay Pattern.

Actor
Ability
Task
Interactions
Questions
Chức năng
Chọn Actor.
Chọn hoặc tự động suy ra Ability.
Đặt tên Task theo nghiệp vụ.
Cấu hình request bằng GUI.
Extract response value.
Lưu variable theo scope.
Tạo Question bằng giao diện.
Chạy một API.
Chạy toàn E2E flow.
Run lại step lỗi.
Debug từ một step.
Xem request, response và execution context.
GUI chung
┌──────────────────────────────────────────────────────────────┐
│ Project | Environment | Protocol | Simple | Run | Save      │
├──────────────────────────────────────────────────────────────┤
│ SCREENPLAY                                                   │
│ Actor:    Authenticated Customer                             │
│ Ability:  REST API · Bearer Token · Test Data                │
│ Task:     Create Payment                                     │
├──────────────────────────────────────────────────────────────┤
│ INTERACTIONS                                                 │
│ Request | Auth | Headers | Body | Extract | Settings         │
├──────────────────────────────────────────────────────────────┤
│ QUESTIONS                                                    │
│ Status = 201                                                 │
│ Payment status = SUCCESS                                     │
│ Payment ID is not null                                       │
├──────────────────────────────────────────────────────────────┤
│ Response | Saved Values | Context | Logs                     │
└──────────────────────────────────────────────────────────────┘
1.2 REST GUI — Simple Mode
┌──────────────────────────────────────────────────────────────┐
│ Create Payment                               [Run API]       │
├──────────────────────────────────────────────────────────────┤
│ Actor: Authenticated Customer                                │
│ Ability: REST API · Bearer Token                             │
│ Task: Create Payment                                         │
├──────────────────────────────────────────────────────────────┤
│ POST  https://{{baseUrl}}/v1/payments                       │
│                                                              │
│ Params | Auth | Headers | Body | Extract | Questions         │
│                                                              │
│ Body                                                         │
│ {                                                            │
│   "orderId": "{{orderId}}",                                  │
│   "amount": "{{amount}}"                                     │
│ }                                                            │
├──────────────────────────────────────────────────────────────┤
│ Extract                                                      │
│ $.data.paymentId → paymentId · Flow Scope                    │
├──────────────────────────────────────────────────────────────┤
│ Questions                                                    │
│ HTTP Status = 201                                            │
│ $.data.status = SUCCESS                                      │
├──────────────────────────────────────────────────────────────┤
│ Response: 201 · 245 ms                                       │
└──────────────────────────────────────────────────────────────┘
REST hỗ trợ
GET
POST
PUT
PATCH
DELETE

Cấu hình:

Path parameters
Query parameters
Headers
Cookies
JSON/XML body
Multipart
File upload
Bearer Token
OAuth2
Basic Auth
API Key
mTLS
1.3 gRPC GUI — Simple Mode
┌──────────────────────────────────────────────────────────────┐
│ Get Payment Status                           [Run RPC]       │
├──────────────────────────────────────────────────────────────┤
│ Actor: Internal Payment Client                              │
│ Ability: gRPC · Metadata Auth · TLS                          │
│ Task: Get Payment Status                                     │
├──────────────────────────────────────────────────────────────┤
│ Host: payment-grpc.dev.internal:9090                         │
│ Service: payment.v1.PaymentService                           │
│ Method: GetPaymentStatus                                     │
│ Type: Unary                                                  │
│                                                              │
│ Metadata | Request | Extract | Questions | Settings          │
│                                                              │
│ Request                                                      │
│ {                                                            │
│   "payment_id": "{{paymentId}}"                              │
│ }                                                            │
├──────────────────────────────────────────────────────────────┤
│ Questions                                                    │
│ gRPC Status = OK                                             │
│ response.status = SUCCESS                                    │
└──────────────────────────────────────────────────────────────┘
gRPC hỗ trợ
Unary
Server Streaming
Client Streaming
Bidirectional Streaming

Cấu hình:

Host and port
TLS/mTLS
Metadata
Deadline
Proto import
Service/method selector
Streaming message viewer
Initial metadata
Trailing metadata
1.4 API Runner — Advanced Mode

Advanced Mode dành cho automation engineer.

Khả năng
Reusable Actors.
Reusable Abilities.
Nested Tasks.
Reusable Interactions.
Reusable Questions.
Conditions.
Loops.
Parallel branches.
Retry policies.
Polling.
Hooks.
Setup/teardown.
Data-driven testing.
Test suites.
Tags.
Parallel execution.
Code generation.
Headless execution.
CI/CD.
GUI Advanced Mode
┌──────────────────┬───────────────────────────────────────────┐
│ Screenplay Assets│ Automation Canvas                         │
│                  │                                           │
│ Actors           │ Actor: Authenticated Customer             │
│ Abilities        │                                           │
│ Tasks            │ Login                                     │
│ Interactions     │   ↓ accessToken                           │
│ Questions        │ Create Payment                            │
│ API Assets       │   ↓ paymentId                             │
│ E2E Flows        │ Poll Payment Status                       │
│ Hooks            │   ↓ status                               │
│ Test Data        │ Confirm Payment                           │
│ Test Suites      │                                           │
├──────────────────┴───────────────────────────────────────────┤
│ Input | Extract | Questions | Retry | Condition | Hooks      │
├──────────────────────────────────────────────────────────────┤
│ Execution | Context | Logs | Trace | Code | Report           │
└──────────────────────────────────────────────────────────────┘
2. UI Runner
Mục tiêu

Kiểm thử giao diện:

Web
Mobile Web
Mobile App

Hỗ trợ:

Single UI Task
End-to-End User Journey
Đối tượng sử dụng
Manual Tester
QA Engineer
Automation Engineer
Mobile QA
Frontend Developer
Khả năng chính
Browser/device session.
Record user actions.
Element inspector.
Object repository.
Click, type, select, scroll.
Upload/download.
Screenshot/video/trace.
Assertions trên UI.
Extract value từ UI.
Reuse value giữa các step.
Data-driven UI test.
Cross-browser/device.
Visual comparison.
Code generation.
CI/CD.
2.1 UI Runner — Simple Mode

Simple Mode hiển thị Screenplay trực tiếp nhưng ở mức đơn giản.

Actor
Ability
Task
Interactions
Questions
GUI
┌──────────────────────────────────────────────────────────────┐
│ Checkout Flow                       [Simple] [Run Flow]      │
├──────────────────┬───────────────────────────────────────────┤
│ Steps            │ Browser Preview                           │
│                  │                                           │
│ 1. Open website  │         Application Under Test            │
│ 2. Login         │                                           │
│ 3. Add product   │                                           │
│ 4. Checkout      │                                           │
│ 5. Verify result │                                           │
├──────────────────┴───────────────────────────────────────────┤
│ SCREENPLAY                                                   │
│ Actor: Customer                                              │
│ Ability: Browse Web · Use Test Data                          │
│ Task: Complete Checkout                                      │
├──────────────────────────────────────────────────────────────┤
│ Interaction: Click "Pay"                                     │
│ Question: Is payment status SUCCESS?                         │
├──────────────────────────────────────────────────────────────┤
│ Screenshot | Video | Console | Network | Saved Values        │
└──────────────────────────────────────────────────────────────┘
Simple Mode hỗ trợ
Record actions.
Add step bằng GUI.
Chọn element bằng inspector.
Chạy từng step.
Chạy từ step hiện tại.
Retry failed step.
Basic wait/polling.
Basic assertions.
Save text/value từ UI.
Business View và Technical View.
2.2 UI Runner — Advanced Mode
Khả năng
Reusable Actor profiles.
Reusable Browse abilities.
Page/Component objects.
Reusable Tasks.
Low-level Interactions.
Reusable Questions.
Conditions.
Loops.
Parallel flows.
Hooks.
Multiple browser contexts.
Cross-browser matrix.
Data-driven suites.
Visual regression.
Network mocking.
Code generation.
CI/CD.
GUI
┌───────────────────┬──────────────────────────────────────────┐
│ Automation Assets │ UI Automation Canvas                     │
│                   │                                          │
│ Actors            │ Actor: Customer                          │
│ Abilities         │                                          │
│ Tasks             │ Open Login Page                          │
│ Interactions      │      ↓                                   │
│ Questions         │ Login                                    │
│ Pages             │      ↓                                   │
│ Components        │ Search Product                           │
│ Object Repository │      ↓                                   │
│ Hooks             │ Checkout                                 │
│ Test Suites       │      ↓                                   │
│                   │ Verify Confirmation                      │
├───────────────────┴──────────────────────────────────────────┤
│ Locator | Input | Condition | Retry | Wait | Questions       │
├──────────────────────────────────────────────────────────────┤
│ Browser | Trace | Network | Console | Code | Report          │
└──────────────────────────────────────────────────────────────┘
Execution engines
Playwright
Selenium
Appium
3. Database + Kafka/Redis Runner
Mục tiêu

Kiểm tra dữ liệu và side effects sau khi API hoặc UI chạy.

Đối tượng sử dụng
Automation Engineer
Backend QA
Integration Tester
Data QA
Developer
Khả năng chính
Database
Execute query.
Verify record exists.
Verify field values.
Compare before/after state.
Insert test data.
Cleanup test data.
Transaction rollback.
Poll asynchronous data.
Mask sensitive fields.
Kafka/MQ
Publish event.
Consume event.
Verify topic.
Verify key/header/payload.
Filter by correlation ID.
Verify retry.
Verify DLQ.
Check message ordering.
Wait for event with timeout.
Redis
Read key.
Write key.
Delete key.
Verify cache value.
Verify session.
Verify TTL.
Verify cache invalidation.
Compare cached and source data.
GUI
┌──────────────────────────────────────────────────────────────┐
│ External Verification                                       │
├──────────────────────────────────────────────────────────────┤
│ Type: [Database | Kafka | Redis]                             │
│                                                              │
│ Database                                                     │
│ Connection: payment-db                                       │
│ Query: SELECT * FROM payment WHERE id={{paymentId}}           │
│ Question: status equals SUCCESS                              │
│                                                              │
│ Kafka                                                        │
│ Topic: payment-created                                       │
│ Filter: payload.paymentId={{paymentId}}                      │
│ Question: message exists                                     │
│                                                              │
│ Redis                                                        │
│ Key: payment:{{paymentId}}                                   │
│ Question: TTL > 0                                            │
└──────────────────────────────────────────────────────────────┘

Runner này thường được gọi như các external Questions:

Was the payment record created?
Was the Kafka event published?
Was the Redis cache updated?
4. AI Runner
Mục tiêu

Hỗ trợ AI trong việc tạo, phân tích, review và tối ưu test asset.

AI Runner không thay thế execution engine. Execution vẫn do API, UI, DB/Event và K6 Runner thực hiện.

Đối tượng sử dụng
Manual Tester
QA Engineer
Automation Engineer
QA Lead
Test Architect
4.1 AI Runner — Simple Mode
Khả năng
Phân tích requirement.
Import và hiểu API specification.
Đề xuất Actor.
Đề xuất Ability.
Đề xuất Task.
Sinh request.
Sinh extract rules.
Phát hiện dependency API.
Sinh Questions.
Sinh negative cases.
Sinh boundary cases.
Ghép E2E flow.
Phân tích lỗi.
Giải thích kết quả bằng ngôn ngữ nghiệp vụ.
GUI
┌──────────────────────────────────────────────────────────────┐
│ AI Assistant — Simple Mode                                  │
├──────────────────────────────────────────────────────────────┤
│ Input                                                        │
│ [Requirement | API Spec | Existing Test | Failure Result]    │
├──────────────────────────────────────────────────────────────┤
│ Suggestions                                                  │
│                                                              │
│ Actor: Authenticated Customer                                │
│ Ability: Call REST API                                       │
│ Task: Create Payment                                         │
│ Extract: $.data.paymentId → paymentId                        │
│ Question: HTTP status equals 201                             │
│                                                              │
│ [Accept] [Edit] [Reject]                                     │
└──────────────────────────────────────────────────────────────┘
4.2 AI Runner — Advanced Mode
Khả năng
Sinh reusable Screenplay components.
Tách Task thành Interactions.
Sinh reusable Questions.
Detect duplicated Tasks.
Review coupling và maintainability.
Generate data-driven tests.
Generate test suite.
Coverage analysis.
Impacted test suggestion.
Generate Java/TypeScript automation.
Convert functional flow sang K6.
Review generated code.
Analyze flaky tests.
Recommend retry/polling.
Analyze execution trace.
GUI
┌──────────────────────────────────────────────────────────────┐
│ AI Automation Workspace                                     │
├──────────────────┬───────────────────────────────────────────┤
│ Source           │ AI Review                                 │
│                  │                                           │
│ Requirement      │ Missing negative case                     │
│ API Spec         │ Duplicate CreatePayment task              │
│ Existing Tasks   │ Suggested reusable Question               │
│ Run History      │ Suggested K6-safe checks                  │
│ Code             │                                           │
├──────────────────┴───────────────────────────────────────────┤
│ Proposed Changes                                            │
│ [Accept Selected] [Edit] [Reject] [Apply to Flow]            │
└──────────────────────────────────────────────────────────────┘

Mọi thay đổi của AI phải qua:

Accept
Edit
Reject
5. Incident Runner
Mục tiêu

Thu thập evidence, phân tích failure và hỗ trợ root cause analysis.

Đối tượng sử dụng
QA Engineer
QA Lead
SRE
Developer
Incident Manager
Trigger
API test fail.
UI test fail.
DB/Kafka/Redis verification fail.
K6 threshold fail.
Timeout.
Dependency failure.
Người dùng tạo incident thủ công.
Khả năng chính
Collect request/response.
Collect UI screenshot/video/trace.
Collect variables và execution context.
Collect logs.
Collect metrics.
Collect distributed traces.
Collect DB state.
Collect Kafka events.
Collect Redis values.
Build incident timeline.
Correlate evidence.
Search similar incidents.
Suggest root cause.
Generate reproduction steps.
Generate incident report.
Create/update ticket.
GUI
┌──────────────────────────────────────────────────────────────┐
│ Incident: Payment Status Timeout                             │
├──────────────────────────────────────────────────────────────┤
│ Summary | Timeline | Evidence | RCA | Similar | Ticket       │
├──────────────────────────────────────────────────────────────┤
│ Timeline                                                     │
│ 10:00:01 Create Payment = SUCCESS                            │
│ 10:00:03 Kafka event published                              │
│ 10:00:35 Status polling timeout                             │
├──────────────────────────────────────────────────────────────┤
│ Evidence                                                     │
│ API response · DB record · Kafka event · Trace · K6 metrics  │
├──────────────────────────────────────────────────────────────┤
│ Suspected root cause                                         │
│ Payment status consumer processing delay                     │
└──────────────────────────────────────────────────────────────┘
6. Performance K6 Runner
Mục tiêu

Kiểm thử tải, độ trễ, throughput, độ ổn định và SLA/SLO.

Đối tượng sử dụng
Performance Engineer
Automation Engineer
Backend QA
SRE
Developer
Nguồn test

K6 Runner tái sử dụng:

Single API
E2E API Flow

từ API Runner.

Có thể tái sử dụng:

Endpoint/service/method.
Auth.
Headers/metadata.
Request body.
Variables.
Extract rules.
Performance-safe Questions.
Test data schema.
Loại test
Smoke
Load
Stress
Spike
Soak
Breakpoint
Khả năng chính
VUs.
Iterations.
Duration.
Arrival rate.
Ramp-up/ramp-down.
Pacing.
Think time.
Data strategy.
Thresholds.
Custom metrics.
REST performance.
gRPC performance.
E2E transaction performance.
K6 script preview/export.
Distributed execution.
Result comparison.
Baseline comparison.
GUI
┌──────────────────────────────────────────────────────────────┐
│ New Performance Test                                        │
├──────────────────────────────────────────────────────────────┤
│ Source                                                       │
│ (•) Single API   ( ) E2E Flow                               │
│ Select: Create Payment                                       │
├──────────────────────────────────────────────────────────────┤
│ Load Profile                                                 │
│ Executor: Ramping VUs                                        │
│ Ramp-up: 1 minute                                            │
│ Hold: 5 minutes                                              │
│ Ramp-down: 1 minute                                          │
│ Target: 100 VUs                                              │
├──────────────────────────────────────────────────────────────┤
│ Data Strategy                                                │
│ Unique per iteration                                         │
├──────────────────────────────────────────────────────────────┤
│ Thresholds                                                   │
│ p95 < 500 ms                                                 │
│ p99 < 1 second                                               │
│ Error rate < 1%                                              │
├──────────────────────────────────────────────────────────────┤
│ [Preview Script] [Run K6]                                    │
└──────────────────────────────────────────────────────────────┘
Metrics
p90
p95
p99
Request duration
Flow duration
Throughput
Requests per second
Error rate
Success rate
Dropped iterations
Connection time
TLS time
Business success rate
Kiến trúc tổng hợp
                         Screenplay Engine
                                │
                     Shared Test Repository
                                │
     ┌──────────────┬──────────────┬──────────────┐
     │              │              │              │
 API Runner     UI Runner     DB/Event Runner   AI Runner
     │              │              │              │
     └──────────────┴──────────────┴──────────────┘
                                │
                  Performance K6 Runner
                                │
                        Incident Runner
Quan hệ giữa các Runner
AI Runner
→ sinh và review test assets

API Runner / UI Runner
→ chạy functional test

Database + Kafka/Redis Runner
→ kiểm tra side effects

Performance K6 Runner
→ tái sử dụng API/E2E flow để chạy performance

Incident Runner
→ thu thập evidence và phân tích khi thất bại
Bảng tóm tắt
| Runner           | Mục tiêu                             | Đối tượng chính              | Điểm nổi bật                                                            |
| ---------------- | ------------------------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| API Runner       | Functional test REST/gRPC và E2E API | Manual, QA, Automation       | Simple/Advanced Mode, extract/reuse variables, GUI riêng REST/gRPC      |
| UI Runner        | Functional UI và E2E user journey    | Manual, QA, Automation       | Simple/Advanced Mode, recorder, inspector, screenshots, code generation |
| DB + Kafka/Redis | Kiểm tra side effects                | Automation, Backend QA       | SQL, event, cache, TTL, external Questions                              |
| AI Runner        | Sinh, review và tối ưu test assets   | QA, QA Lead, Automation      | Simple/Advanced Mode, suggestions, generation, review                   |
| Incident Runner  | Evidence, timeline và RCA            | QA, SRE, Dev                 | Logs, trace, metrics, reports, ticket                                   |
| Performance K6   | Load, latency và SLA/SLO             | Performance, Automation, SRE | Reuse API/E2E assets, load profiles, thresholds, metrics                |
