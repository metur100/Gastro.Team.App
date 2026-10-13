using GastroTeam.Infrastructure.Messaging;
using MailKit.Security;

namespace GastroTeam.Tests.Unit;

[Trait("Category", "Unit")]
public class EmailTests
{
    [Theory]
    [InlineData("e2e-owner@e2e.gastroteam.example", true)]
    [InlineData("demo@rheinblick.example", true)]
    [InlineData("x@example.com", true)]
    [InlineData("deleted-1@deleted.invalid", true)]
    [InlineData("someone@host.test", true)]
    [InlineData("office@gentlegroup.de", false)]
    [InlineData("mia@gastro-beispiel.de", false)]
    public void Reserved_test_domains_never_receive_mail(string address, bool reserved)
    {
        Assert.Equal(reserved, SmtpEmailSender.IsReservedDomain(address));
    }

    [Theory]
    [InlineData(465, "Auto", SecureSocketOptions.SslOnConnect)]
    [InlineData(587, "Auto", SecureSocketOptions.StartTls)]
    [InlineData(25, "SslOnConnect", SecureSocketOptions.SslOnConnect)]
    [InlineData(465, "StartTls", SecureSocketOptions.StartTls)]
    public void Smtp_security_is_derived_from_port_or_configuration(int port, string security, SecureSocketOptions expected)
    {
        Assert.Equal(expected, new EmailOptions { SmtpPort = port, Security = security }.SocketOptions);
    }
}
