using System.Net;
using System.Text.Json;
using GastroTeam.Application.Features.Account;

namespace GastroTeam.Tests.Integration;

[Trait("Category", "Integration")]
public class AuthTests(GastroTeamFactory factory) : IClassFixture<GastroTeamFactory>
{
    [Fact]
    public async Task Registration_requires_email_verification_before_login()
    {
        var client = factory.Client();
        var email = Scenario.UniqueEmail("verify");
        var reg = await client.PostAsync<JsonElement>("/auth/register", new { email, password = Scenario.Password, firstName = "Vera", lastName = "Test", acceptTerms = true });
        Assert.True(reg.GetProperty("requiresEmailVerification").GetBoolean());

        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/login", HttpStatusCode.Unauthorized, "email_not_verified", new { email, password = Scenario.Password });

        var mail = Assert.Single(factory.Mailbox.All(email), m => m.Subject.Contains("bestätigen"));
        var link = Scenario.ExtractLink(mail.Text, "email-bestaetigen");
        var q = System.Web.HttpUtility.ParseQueryString(new Uri(link).Query);
        Assert.True((await client.PostRawAsync("/auth/verify-email", new { userId = Guid.Parse(q["userId"]!), token = q["token"] })).IsSuccessStatusCode);

        await client.LoginAsync(email, Scenario.Password);
        var me = await client.GetAsync<MeDto>("/auth/me");
        Assert.Equal(email, me.Email);
        Assert.True(me.EmailConfirmed);
        Assert.Null(me.CurrentTenant);
    }

    [Fact]
    public async Task Invalid_registration_and_duplicate_email_are_rejected()
    {
        var client = factory.Client();
        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/register", HttpStatusCode.BadRequest, "validation_failed",
            new { email = "kein-email", password = "kurz", firstName = "", lastName = "", acceptTerms = false });
        var email = Scenario.UniqueEmail("dup");
        await Scenario.RegisterAndVerifyAsync(client, email, "Dora", "Dup");
        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/register", HttpStatusCode.Conflict, "email_taken",
            new { email, password = Scenario.Password, firstName = "Dora", lastName = "Dup", acceptTerms = true });
    }

    [Fact]
    public async Task Wrong_password_fails_and_account_locks_after_five_attempts()
    {
        var client = factory.Client();
        var email = Scenario.UniqueEmail("lock");
        await Scenario.RegisterAndVerifyAsync(client, email, "Lena", "Lock");
        for (var i = 0; i < 5; i++)
            await client.ExpectFailureAsync(HttpMethod.Post, "/auth/login", HttpStatusCode.Unauthorized, i < 4 ? "invalid_credentials" : null, new { email, password = "falsches-passwort" });
        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/login", HttpStatusCode.Unauthorized, "locked_out", new { email, password = Scenario.Password });
    }

    [Fact]
    public async Task Unknown_user_gets_the_same_error_as_wrong_password()
    {
        await factory.Client().ExpectFailureAsync(HttpMethod.Post, "/auth/login", HttpStatusCode.Unauthorized, "invalid_credentials",
            new { email = Scenario.UniqueEmail("nobody"), password = "irgendwas-123" });
    }

    [Fact]
    public async Task Refresh_token_rotation_detects_reuse_and_revokes_the_family()
    {
        var client = factory.Client();
        var email = Scenario.UniqueEmail("rotate");
        await Scenario.RegisterAndVerifyAsync(client, email, "Rita", "Rotate");
        await client.LoginAsync(email, Scenario.Password);
        var first = client.RefreshToken!;

        var second = (await client.RefreshAsync()).RefreshToken!;
        Assert.NotEqual(first, second);

        // Reusing the rotated token is treated as theft: it fails and the newest token is revoked too.
        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/refresh", HttpStatusCode.Unauthorized, "invalid_session", new { refreshToken = first });
        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/refresh", HttpStatusCode.Unauthorized, "invalid_session", new { refreshToken = second });
    }

    [Fact]
    public async Task Revoked_session_cannot_refresh_after_logout()
    {
        var client = factory.Client();
        var email = Scenario.UniqueEmail("logout");
        await Scenario.RegisterAndVerifyAsync(client, email, "Lou", "Out");
        await client.LoginAsync(email, Scenario.Password);
        var token = client.RefreshToken!;
        Assert.True((await client.PostRawAsync("/auth/logout", new { refreshToken = token })).IsSuccessStatusCode);
        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/refresh", HttpStatusCode.Unauthorized, "invalid_session", new { refreshToken = token });
    }

    [Fact]
    public async Task Password_change_invalidates_existing_access_tokens()
    {
        var client = factory.Client();
        var email = Scenario.UniqueEmail("pwchange");
        await Scenario.RegisterAndVerifyAsync(client, email, "Paul", "Change");
        await client.LoginAsync(email, Scenario.Password);
        Assert.True((await client.PostRawAsync("/auth/change-password", new { currentPassword = Scenario.Password, newPassword = "Neues-Passwort-2026" })).IsSuccessStatusCode);
        await client.ExpectFailureAsync(HttpMethod.Get, "/auth/me", HttpStatusCode.Unauthorized);
        await client.LoginAsync(email, "Neues-Passwort-2026");
        await client.GetAsync<MeDto>("/auth/me");
    }

    [Fact]
    public async Task Password_reset_flow_works_and_does_not_reveal_accounts()
    {
        var client = factory.Client();
        var email = Scenario.UniqueEmail("reset");
        await Scenario.RegisterAndVerifyAsync(client, email, "Rosa", "Reset");
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostRawAsync("/auth/forgot-password", new { email = Scenario.UniqueEmail("unknown") })).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostRawAsync("/auth/forgot-password", new { email })).StatusCode);
        var mail = Assert.Single(factory.Mailbox.All(email), m => m.Subject.Contains("Passwort"));
        var q = System.Web.HttpUtility.ParseQueryString(new Uri(Scenario.ExtractLink(mail.Text, "passwort-zuruecksetzen")).Query);
        await client.ExpectFailureAsync(HttpMethod.Post, "/auth/reset-password", HttpStatusCode.UnprocessableEntity, "invalid_token", new { email, token = "falsch", newPassword = "Noch-ein-Passwort-1" });
        Assert.True((await client.PostRawAsync("/auth/reset-password", new { email, token = q["token"], newPassword = "Noch-ein-Passwort-1" })).IsSuccessStatusCode);
        await client.LoginAsync(email, "Noch-ein-Passwort-1");
    }

    [Fact]
    public async Task Browser_refresh_uses_http_only_cookie_and_requires_csrf_header()
    {
        var http = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { HandleCookies = false });
        var email = Scenario.UniqueEmail("cookie");
        await Scenario.RegisterAndVerifyAsync(factory.Client(), email, "Coco", "Cookie");

        var login = await http.PostAsync("/api/v1/auth/login", System.Net.Http.Json.JsonContent.Create(new { email, password = Scenario.Password }));
        Assert.True(login.IsSuccessStatusCode);
        var body = await login.Content.ReadAsStringAsync();
        Assert.Contains("\"refreshToken\":null", body); // never exposed to browser JS
        var setCookie = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/v1/auth", setCookie, StringComparison.OrdinalIgnoreCase);
        var cookie = setCookie.Split(';')[0];

        var noCsrf = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/refresh") { Content = System.Net.Http.Json.JsonContent.Create(new { }) };
        noCsrf.Headers.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(noCsrf)).StatusCode);

        var ok = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/refresh") { Content = System.Net.Http.Json.JsonContent.Create(new { }) };
        ok.Headers.Add("Cookie", cookie);
        ok.Headers.Add("X-Requested-With", "GastroTeam");
        var refreshed = await http.SendAsync(ok);
        Assert.True(refreshed.IsSuccessStatusCode, await refreshed.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Protected_endpoints_require_authentication()
    {
        var client = factory.Client();
        await client.ExpectFailureAsync(HttpMethod.Get, "/employees", HttpStatusCode.Unauthorized);
        await client.ExpectFailureAsync(HttpMethod.Get, "/auth/me", HttpStatusCode.Unauthorized);
        client.UseToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid");
        await client.ExpectFailureAsync(HttpMethod.Get, "/auth/me", HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Security_headers_are_present_and_errors_are_problem_details()
    {
        var res = await factory.Client().SendAsync(HttpMethod.Get, "/employees");
        Assert.Equal("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", res.Headers.GetValues("X-Frame-Options").Single());
        var problem = await factory.Client().SendAsync(HttpMethod.Post, "/auth/login", new { email = "x@test.example", password = "y" });
        Assert.Equal("application/problem+json", problem.Content.Headers.ContentType?.MediaType);
        Assert.DoesNotContain("StackTrace", await problem.Content.ReadAsStringAsync());
    }
}
